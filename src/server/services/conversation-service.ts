import { NotFoundError } from "@/lib/errors";
import type { BookRepository } from "@/server/repositories/book-repository";
import type { ConversationRepository } from "@/server/repositories/conversation-repository";
import type { ConversationSummary, MessageDTO } from "@/types/api";

import { toMessageDTO } from "./mappers";

export class ConversationService {
  constructor(
    private readonly deps: { books: BookRepository; conversations: ConversationRepository },
  ) {}

  async list(bookId: string): Promise<ConversationSummary[]> {
    const book = await this.deps.books.findById(bookId);
    if (!book) throw new NotFoundError("Book");
    const rows = await this.deps.conversations.listForBook(bookId);
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      lastMessageAt: row.lastMessageAt.toISOString(),
      messageCount: Number(row.messageCount),
    }));
  }

  async messages(conversationId: string): Promise<{ bookId: string; title: string; messages: MessageDTO[] }> {
    const conversation = await this.deps.conversations.findById(conversationId);
    if (!conversation) throw new NotFoundError("Conversation");
    const messages = await this.deps.conversations.listMessages(conversationId);
    return { bookId: conversation.bookId, title: conversation.title, messages: messages.map(toMessageDTO) };
  }

  async rename(conversationId: string, title: string) {
    const conversation = await this.deps.conversations.rename(conversationId, title.trim().slice(0, 120));
    if (!conversation) throw new NotFoundError("Conversation");
    return { id: conversation.id, title: conversation.title };
  }

  async delete(conversationId: string) {
    const deleted = await this.deps.conversations.delete(conversationId);
    if (!deleted) throw new NotFoundError("Conversation");
  }
}
