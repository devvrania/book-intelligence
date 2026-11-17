import type { Conversation } from "@/lib/db/schema";
import { NotFoundError } from "@/lib/errors";
import type { BookRepository } from "@/server/repositories/book-repository";
import type { ConversationRepository } from "@/server/repositories/conversation-repository";
import type { ConversationSummary, MessageDTO } from "@/types/api";

import { toMessageDTO } from "./mappers";

/**
 * Chats are private to the anonymous visitor who started them. Another visitor's chat (or an old shared one with no
 * owner) is reported as not found, the same as one that doesn't exist, so ids can't be probed.
 */
export function ownsConversation(conversation: Conversation | null, visitorId: string | null): conversation is Conversation {
  return !!conversation && !!visitorId && conversation.visitorId === visitorId;
}

export class ConversationService {
  constructor(
    private readonly deps: { books: BookRepository; conversations: ConversationRepository },
  ) {}

  /** This visitor's chats about a book (none for a visitor who hasn't asked anything yet). */
  async list(bookId: string, visitorId: string | null): Promise<ConversationSummary[]> {
    const book = await this.deps.books.findById(bookId);
    if (!book) throw new NotFoundError("Book");
    if (!visitorId) return [];
    const rows = await this.deps.conversations.listForBook(bookId, visitorId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      lastMessageAt: row.lastMessageAt.toISOString(),
      messageCount: Number(row.messageCount),
    }));
  }

  async messages(
    conversationId: string,
    visitorId: string | null,
  ): Promise<{ bookId: string; title: string; messages: MessageDTO[] }> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!ownsConversation(conversation, visitorId)) throw new NotFoundError("Conversation");
    const messages = await this.deps.conversations.listMessages(conversationId);
    return { bookId: conversation.bookId, title: conversation.title, messages: messages.map(toMessageDTO) };
  }

  async rename(conversationId: string, visitorId: string | null, title: string) {
    await this.assertOwned(conversationId, visitorId);
    const conversation = await this.deps.conversations.rename(conversationId, title.trim().slice(0, 120));
    if (!conversation) throw new NotFoundError("Conversation");
    return { id: conversation.id, title: conversation.title };
  }

  async delete(conversationId: string, visitorId: string | null) {
    await this.assertOwned(conversationId, visitorId);
    const deleted = await this.deps.conversations.delete(conversationId);
    if (!deleted) throw new NotFoundError("Conversation");
  }

  private async assertOwned(conversationId: string, visitorId: string | null) {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!ownsConversation(conversation, visitorId)) throw new NotFoundError("Conversation");
  }
}
