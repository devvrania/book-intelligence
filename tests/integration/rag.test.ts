import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { conversations, documentChunks, messageSources } from "@/lib/db/schema";
import { NO_CONTEXT_ANSWER } from "@/lib/rag/prompts";
import type { ChatStreamEvent } from "@/types/api";

import { createTestDb } from "../helpers/db";
import { createReadyBook, createTestServices, GARDENING_BOOK } from "../helpers/factories";
import { FakeChatProvider } from "../helpers/fakes";
import type { Database } from "@/lib/db/client";

const VISITOR = "11111111-1111-4111-8111-111111111111";
const OTHER_VISITOR = "22222222-2222-4222-8222-222222222222";

async function ask(
  ctx: ReturnType<typeof createTestServices>,
  bookId: string,
  message: string,
  conversationId?: string,
  visitorId = VISITOR,
) {
  const prepared = await ctx.services.chat.prepare({ bookId, visitorId, message, conversationId });
  const events: ChatStreamEvent[] = [];
  for await (const event of ctx.services.chat.stream(prepared)) events.push(event);
  const done = events.find((e): e is Extract<ChatStreamEvent, { type: "done" }> => e.type === "done");
  return { events, done, conversationId: prepared.conversation.id };
}

describe("RAG answering", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ctx: ReturnType<typeof createTestServices>;
  let chat: FakeChatProvider;
  let bookId: string;

  beforeAll(async () => {
    const test = await createTestDb();
    db = test.db;
    close = test.close;
    chat = new FakeChatProvider();
    ctx = createTestServices(db, chat);
    bookId = (await createReadyBook(ctx.services, "The Gardener's Year", GARDENING_BOOK)).id;
  });
  afterAll(async () => close());

  it("streams status, sources, answer deltas and a final message", async () => {
    const { events } = await ask(ctx, bookId, "What causes blossom end rot on tomatoes?");
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("conversation");
    expect(types).toContain("sources");
    expect(types).toContain("delta");
    expect(types.at(-1)).toBe("done");
    expect(types.indexOf("sources")).toBeLessThan(types.indexOf("delta"));
  });

  it("sends the retrieved passages to the model, separated from instructions", async () => {
    chat.requests = [];
    await ask(ctx, bookId, "What causes blossom end rot on tomatoes?");
    const request = chat.requests.at(-1)!;
    const system = request.messages[0];
    const user = request.messages.at(-1)!;
    expect(system.role).toBe("system");
    expect(system.content).not.toContain("calcium");
    expect(user.content).toContain("<book_context>");
    expect(user.content).toContain("Blossom end rot on tomatoes is caused by uneven watering and a shortage of calcium.");
    expect(user.content).toContain("Reader's question: What causes blossom end rot on tomatoes?");
  });

  it("stores citations that correspond exactly to retrieved chunks", async () => {
    chat.respond = (request) => {
      const ids = [...(request.messages.at(-1)?.content ?? "").matchAll(/<source id="(S\d+)"/g)].map((m) => m[1]);
      return `Uneven watering is the cause [${ids[0]}]. A made-up claim [S42].`;
    };
    const { done } = await ask(ctx, bookId, "What causes blossom end rot on tomatoes?");
    expect(done).toBeDefined();
    const message = done!.message;

    // The fabricated [S42] marker is removed; only real sources remain cited.
    expect(message.content).toBe("Uneven watering is the cause [S1]. A made-up claim.");
    const cited = message.sources.filter((s) => s.cited);
    expect(cited.map((s) => s.label)).toEqual(["S1"]);

    // Every stored source points at a real chunk of this book, with a faithful snapshot.
    const rows = await db.select().from(messageSources).where(eq(messageSources.messageId, message.id));
    expect(rows.length).toBe(message.sources.length);
    for (const row of rows) {
      const [chunkRow] = await db.select().from(documentChunks).where(eq(documentChunks.id, row.chunkId!));
      expect(chunkRow.bookId).toBe(bookId);
      expect(row.snapshot.content).toBe(chunkRow.content);
      expect(row.snapshot.pageStart).toBe(chunkRow.pageStart);
    }
    chat.respond = new FakeChatProvider().respond;
  });

  it("answers 'not in the book' without calling the model when nothing relevant is retrieved", async () => {
    chat.requests = [];
    const { done } = await ask(ctx, bookId, "Explain quantum entanglement between photons");
    expect(chat.requests).toHaveLength(0);
    expect(done!.message.content).toBe(NO_CONTEXT_ANSWER);
    expect(done!.message.sources).toEqual([]);
    expect(done!.message.noContext).toBe(true);
  });

  it("continues a conversation with history", async () => {
    const first = await ask(ctx, bookId, "How should roses be pruned?");
    chat.requests = [];
    await ask(ctx, bookId, "And what about their diseases?", first.conversationId);
    const request = chat.requests.at(-1)!;
    expect(request.messages.some((m) => m.role === "assistant")).toBe(true);
    expect(request.messages.some((m) => m.role === "user" && m.content === "How should roses be pruned?")).toBe(true);
    const { messages } = await ctx.services.conversations.messages(first.conversationId, VISITOR);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("refuses to chat with a book that isn't ready", async () => {
    const pending = await ctx.services.repositories.books.create({ title: "Pending", status: "PROCESSING" });
    await expect(ctx.services.chat.prepare({ bookId: pending.id, visitorId: VISITOR, message: "hi" })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("private chats", () => {
  let close: () => Promise<void>;
  let ctx: ReturnType<typeof createTestServices>;
  let bookId: string;

  beforeAll(async () => {
    const test = await createTestDb();
    close = test.close;
    ctx = createTestServices(test.db, new FakeChatProvider());
    bookId = (await createReadyBook(ctx.services, "The Gardener's Year", GARDENING_BOOK)).id;
  });
  afterAll(async () => close());

  it("only lists a visitor's own chats", async () => {
    const mine = await ask(ctx, bookId, "How should roses be pruned?");
    const theirs = await ask(ctx, bookId, "When do tulips flower?", undefined, OTHER_VISITOR);

    expect((await ctx.services.conversations.list(bookId, VISITOR)).map((c) => c.id)).toEqual([mine.conversationId]);
    expect((await ctx.services.conversations.list(bookId, OTHER_VISITOR)).map((c) => c.id)).toEqual([theirs.conversationId]);
    // a browser that hasn't asked anything yet (no visitor cookie) sees no chats
    expect(await ctx.services.conversations.list(bookId, null)).toEqual([]);
  });

  it("hides another visitor's chat as if it didn't exist", async () => {
    const mine = await ask(ctx, bookId, "What do roses need in winter?");
    const notFound = { code: "not_found" };

    await expect(ctx.services.conversations.messages(mine.conversationId, OTHER_VISITOR)).rejects.toMatchObject(notFound);
    await expect(ctx.services.conversations.messages(mine.conversationId, null)).rejects.toMatchObject(notFound);
    await expect(
      ctx.services.chat.prepare({ bookId, visitorId: OTHER_VISITOR, message: "Me too?", conversationId: mine.conversationId }),
    ).rejects.toMatchObject(notFound);
    await expect(ctx.services.conversations.rename(mine.conversationId, OTHER_VISITOR, "Hijacked")).rejects.toMatchObject(notFound);
    await expect(ctx.services.conversations.delete(mine.conversationId, OTHER_VISITOR)).rejects.toMatchObject(notFound);

    // ...and the owner still has it, untouched
    const { title, messages } = await ctx.services.conversations.messages(mine.conversationId, VISITOR);
    expect(title).not.toBe("Hijacked");
    expect(messages).toHaveLength(2);
  });

  it("shows old shared chats (no owner) to no one", async () => {
    const legacy = await ctx.services.repositories.conversations.create({
      bookId,
      visitorId: VISITOR,
      title: "Old shared chat",
    });
    await ctx.services.db.update(conversations).set({ visitorId: null }).where(eq(conversations.id, legacy.id));

    expect((await ctx.services.conversations.list(bookId, VISITOR)).some((c) => c.id === legacy.id)).toBe(false);
    await expect(ctx.services.conversations.messages(legacy.id, VISITOR)).rejects.toMatchObject({ code: "not_found" });
  });
});
