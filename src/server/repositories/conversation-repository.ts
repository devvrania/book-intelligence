import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/lib/db/client";
import {
  conversations,
  messages,
  messageSources,
  type Conversation,
  type Message,
  type MessageSource,
} from "@/lib/db/schema";
import type { MessageMetadata, SourceSnapshot } from "@/types/domain";

export interface NewMessageSource {
  chunkId: string | null;
  rank: number;
  similarityScore: number | null;
  keywordScore: number | null;
  score: number;
  cited: boolean;
  snapshot: SourceSnapshot;
}

export type MessageWithSources = Message & { sources: MessageSource[] };

export class ConversationRepository {
  constructor(private readonly db: Database) {}

  async create(values: { bookId: string; title: string }): Promise<Conversation> {
    const [conversation] = await this.db.insert(conversations).values(values).returning();
    return conversation;
  }

  async findById(conversationId: string): Promise<Conversation | null> {
    const [conversation] = await this.db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
    return conversation ?? null;
  }

  async listForBook(bookId: string, limit = 50) {
    return this.db
      .select({
        id: conversations.id,
        title: conversations.title,
        lastMessageAt: conversations.lastMessageAt,
        createdAt: conversations.createdAt,
        messageCount: sql<number>`(select count(*)::int from ${messages} m where m.conversation_id = ${conversations.id})`,
      })
      .from(conversations)
      .where(eq(conversations.bookId, bookId))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(limit);
  }

  async rename(conversationId: string, title: string): Promise<Conversation | null> {
    const [conversation] = await this.db
      .update(conversations)
      .set({ title })
      .where(eq(conversations.id, conversationId))
      .returning();
    return conversation ?? null;
  }

  async delete(conversationId: string): Promise<boolean> {
    const deleted = await this.db
      .delete(conversations)
      .where(eq(conversations.id, conversationId))
      .returning({ id: conversations.id });
    return deleted.length > 0;
  }

  async insertMessage(values: {
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    status?: "complete" | "error";
    metadata?: MessageMetadata;
  }): Promise<Message> {
    const [message] = await this.db.insert(messages).values(values).returning();
    await this.db
      .update(conversations)
      .set({ lastMessageAt: message.createdAt })
      .where(eq(conversations.id, values.conversationId));
    return message;
  }

  /** Persist an assistant answer together with its sources, atomically. */
  async insertAnswer(
    values: { conversationId: string; content: string; status: "complete" | "error"; metadata: MessageMetadata },
    sources: NewMessageSource[],
  ): Promise<MessageWithSources> {
    return this.db.transaction(async (tx) => {
      const [message] = await tx.insert(messages).values({ ...values, role: "assistant" }).returning();
      const inserted = sources.length
        ? await tx
            .insert(messageSources)
            .values(sources.map((source) => ({ ...source, messageId: message.id })))
            .returning()
        : [];
      await tx
        .update(conversations)
        .set({ lastMessageAt: message.createdAt })
        .where(eq(conversations.id, values.conversationId));
      return { ...message, sources: inserted.sort((a, b) => a.rank - b.rank) };
    });
  }

  async listMessages(conversationId: string, limit = 200): Promise<MessageWithSources[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(asc(messages.createdAt))
      .limit(limit);
    if (rows.length === 0) return [];

    const sources = await this.db
      .select()
      .from(messageSources)
      .where(inArray(messageSources.messageId, rows.map((row) => row.id)))
      .orderBy(asc(messageSources.rank));

    const byMessage = new Map<string, MessageSource[]>();
    for (const source of sources) {
      byMessage.set(source.messageId, [...(byMessage.get(source.messageId) ?? []), source]);
    }
    return rows.map((row) => ({ ...row, sources: byMessage.get(row.id) ?? [] }));
  }

  /** The last `limit` complete messages, oldest first (conversation memory for the model). */
  async recentHistory(conversationId: string, limit: number): Promise<Pick<Message, "role" | "content">[]> {
    const rows = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(and(eq(messages.conversationId, conversationId), eq(messages.status, "complete")))
      .orderBy(desc(messages.createdAt))
      .limit(limit);
    return rows.reverse();
  }
}
