import { describe, expect, it } from "vitest";

import { buildContext } from "@/lib/rag/context-builder";
import { CITATION_REMINDER, NOT_IN_BOOK_MARKER } from "@/lib/rag/prompts";
import { RAGService, RefusalMarkerFilter, stripRefusalMarker, type AnswerEvent } from "@/lib/rag/rag-service";
import type { RankedChunk } from "@/lib/retrieval/reranking-service";

import { FakeChatProvider } from "../helpers/fakes";

const context = buildContext(
  [
    {
      id: "c1",
      chunkIndex: 0,
      content: "Roses are pruned in late winter, just before the buds break.",
      chapterId: "ch",
      chapterNumber: 1,
      chapterTitle: "Roses",
      chapterLabel: "Chapter 1",
      sectionTitle: null,
      tokenCount: 20,
      pageStart: 4,
      pageEnd: 4,
      metadata: {},
      semanticScore: 0.8,
      keywordScore: 0.2,
      hybridScore: 0.9,
      score: 0.9,
      matchedBy: ["semantic"],
    } satisfies RankedChunk,
  ],
  { maxTokens: 1000 },
);

/** Replies with each scripted answer in turn (the last one repeats). */
function scripted(...answers: string[]) {
  let call = 0;
  return new FakeChatProvider(() => answers[Math.min(call++, answers.length - 1)]);
}

async function answer(chat: FakeChatProvider) {
  const events: AnswerEvent[] = [];
  for await (const event of new RAGService(chat).stream({ book: { title: "Roses", author: null }, question: "When are roses pruned?", queryType: "factual", context })) {
    events.push(event);
  }
  const done = events.find((e): e is Extract<AnswerEvent, { type: "done" }> => e.type === "done")!;
  const shown = events.reduce((text, e) => (e.type === "reset" ? "" : e.type === "delta" ? text + e.text : text), "");
  return { events, done, shown };
}

describe("refusal marker", () => {
  it("is hidden from the stream however the model splits it", () => {
    for (const pieces of [["[NOT_IN_BOOK] The book"], ["[NOT", "_IN_", "BOOK]", " The book"], ["  [N", "OT_IN_BOOK]The book"]]) {
      const filter = new RefusalMarkerFilter();
      const shown = pieces.map((piece) => filter.push(piece)).join("") + filter.flush();
      expect(shown).toBe("The book");
      expect(filter.refusal).toBe(true);
    }
  });

  it("lets normal answers through untouched, including ones starting with a bracket", () => {
    for (const pieces of [["Roses are pruned [S1]."], ["[", "S1] says roses…"], ["[N", "ote] roses"]]) {
      const filter = new RefusalMarkerFilter();
      expect(pieces.map((piece) => filter.push(piece)).join("") + filter.flush()).toBe(pieces.join(""));
      expect(filter.refusal).toBe(false);
    }
  });

  it("is also removed from the final text when the model puts it mid-answer", () => {
    expect(stripRefusalMarker(`The passages don't say. ${NOT_IN_BOOK_MARKER}`)).toEqual({ text: "The passages don't say. ", refusal: true });
  });
});

describe("grounding check", () => {
  it("keeps a cited answer as is, without retrying", async () => {
    const chat = scripted("Roses are pruned in late winter [S1].");
    const { done, events } = await answer(chat);
    expect(done.grounding).toBe("cited");
    expect(done.retried).toBe(false);
    expect(events.some((e) => e.type === "reset")).toBe(false);
    expect(chat.requests).toHaveLength(1);
  });

  it("treats an honest refusal as 'not in the book', without retrying or warning", async () => {
    const chat = scripted(`${NOT_IN_BOOK_MARKER} The book doesn't say who planted the garden.`);
    const { done, shown } = await answer(chat);
    expect(done.grounding).toBe("not_in_book");
    expect(done.retried).toBe(false);
    expect(done.answer).not.toContain(NOT_IN_BOOK_MARKER);
    expect(shown).toBe("The book doesn't say who planted the garden.");
    expect(chat.requests).toHaveLength(1);
  });

  it("regenerates an uncited answer once with a reminder, replacing the draft", async () => {
    const chat = scripted("Roses love sunshine and green ink.", "Roses are pruned in late winter [S1].");
    const { done, events, shown } = await answer(chat);
    expect(events.filter((e) => e.type === "reset")).toHaveLength(1);
    expect(chat.requests).toHaveLength(2);
    expect(chat.requests[1].messages.at(-1)!.content).toContain(CITATION_REMINDER);
    expect(done.grounding).toBe("cited");
    expect(done.retried).toBe(true);
    expect(shown).toBe("Roses are pruned in late winter [S1].");
  });

  it("marks the answer 'uncited' when the retry still cites nothing", async () => {
    const chat = scripted("Roses love sunshine.", "Roses really love sunshine.");
    const { done } = await answer(chat);
    expect(chat.requests).toHaveLength(2);
    expect(done.grounding).toBe("uncited");
    expect(done.retried).toBe(true);
  });

  it("accepts a refusal on the retry", async () => {
    const chat = scripted("Roses love sunshine.", `${NOT_IN_BOOK_MARKER} The book doesn't cover that.`);
    const { done } = await answer(chat);
    expect(done.grounding).toBe("not_in_book");
  });
});
