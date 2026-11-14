import type { RetrievalConfig } from "@/lib/config/env";
import type { Chapter } from "@/lib/db/schema";
import { truncate } from "@/lib/documents/text-utils";
import type { EmbeddingService } from "@/lib/embeddings/embedding-service";
import { ConflictError, NotFoundError, toUserMessage, ValidationError, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { buildContext, type BuiltContext } from "@/lib/rag/context-builder";
import type { RAGService } from "@/lib/rag/rag-service";
import type { RateLimiter } from "@/lib/rate-limit";
import { analyzeQuery, topKForQuery, type QueryAnalysis } from "@/lib/retrieval/query-analyzer";
import type { QueryRewriter } from "@/lib/retrieval/query-rewriter";
import type { Reranker } from "@/lib/retrieval/reranking-service";
import type { RetrievalService } from "@/lib/retrieval/retrieval-service";
import type { Book, Conversation } from "@/lib/db/schema";
import type { BookRepository } from "@/server/repositories/book-repository";
import type { ConversationRepository, NewMessageSource } from "@/server/repositories/conversation-repository";
import type { DocumentRepository } from "@/server/repositories/document-repository";
import type { ChatStreamEvent, ConversationSummary, SourceDTO } from "@/types/api";
import type { MessageMetadata, MessageSelection } from "@/types/domain";

import { toMessageDTO } from "./mappers";

export interface ChatServiceDeps {
  books: BookRepository;
  documents: DocumentRepository;
  conversations: ConversationRepository;
  embeddings: EmbeddingService;
  retrieval: RetrievalService;
  reranker: Reranker;
  rag: RAGService;
  rewriter: QueryRewriter;
  rateLimiter: RateLimiter;
  retrievalConfig: RetrievalConfig;
  chatRateLimitPerMinute: number;
  chatRateLimitPerDay?: number;
}

export interface AskInput {
  bookId: string;
  message: string;
  conversationId?: string | null;
  chapterId?: string | null;
  selection?: { text?: string | null; pageNumber?: number | null } | null;
}

export interface PreparedChat {
  book: Book;
  chapters: Chapter[];
  conversation: Conversation;
  isNewConversation: boolean;
  message: string;
  scopeChapterId: string | null;
  selection: MessageSelection | null;
}

const MAX_MESSAGE_CHARS = 4000;
const MAX_SELECTION_CHARS = 4000;
const HISTORY_MESSAGES = 6;

function conversationTitle(message: string) {
  return truncate(message.replace(/\s+/g, " ").trim(), 70);
}

/**
 * Orchestrates one question → grounded, cited answer:
 *
 *   understand query → (rewrite follow-up) → hybrid retrieval → rerank →
 *   build context → stream LLM answer → validate citations → persist
 */
export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  /**
   * Everything that can fail with a clean HTTP error happens here, before the
   * response stream starts: auth scoping, rate limits, book readiness, input checks.
   */
  async prepare(input: AskInput): Promise<PreparedChat> {
    const message = input.message.trim();
    if (!message) throw new ValidationError("Please enter a question.");
    if (message.length > MAX_MESSAGE_CHARS) throw new ValidationError("That question is too long.");

    // Limits are shared by everyone using the app (there are no accounts)
    await this.deps.rateLimiter.consume("chat", {
      limit: this.deps.chatRateLimitPerMinute,
      windowSeconds: 60,
    });
    if (this.deps.chatRateLimitPerDay) {
      await this.deps.rateLimiter.consume("chat-day", {
        limit: this.deps.chatRateLimitPerDay,
        windowSeconds: 86_400,
      });
    }

    const book = await this.deps.books.findById(input.bookId);
    if (!book) throw new NotFoundError("Book");
    if (book.status !== "READY") throw new ConflictError("This book is still being prepared. Try again once it's ready.");
    if (!this.deps.embeddings.isCompatibleWith(book.embeddingModel)) {
      throw new ConflictError(
        "This book was indexed with a different embedding model than the one configured now. Re-index the book (“Process again”) to keep asking questions.",
      );
    }

    const chapters = await this.deps.documents.listChapters(book.id);
    const scopeChapterId = input.chapterId ?? null;
    if (scopeChapterId && !chapters.some((chapter) => chapter.id === scopeChapterId)) {
      throw new ValidationError("That chapter doesn't belong to this book.");
    }

    let conversation: Conversation | null = null;
    let isNewConversation = false;
    if (input.conversationId) {
      conversation = await this.deps.conversations.findById(input.conversationId);
      if (!conversation || conversation.bookId !== book.id) throw new NotFoundError("Conversation");
    } else {
      conversation = await this.deps.conversations.create({
        bookId: book.id,
        title: conversationTitle(message),
      });
      isNewConversation = true;
    }

    const selection = await this.resolveSelection(book, input.selection);
    return { book, chapters, conversation, isNewConversation, message, scopeChapterId, selection };
  }

  private async resolveSelection(book: Book, raw: AskInput["selection"]): Promise<MessageSelection | null> {
    if (!raw) return null;
    const pageNumber =
      raw.pageNumber && Number.isInteger(raw.pageNumber) && raw.pageNumber >= 1 && raw.pageNumber <= (book.pageCount ?? 0)
        ? raw.pageNumber
        : undefined;
    const text = raw.text?.trim();
    if (text) return { text: text.slice(0, MAX_SELECTION_CHARS), pageNumber };
    if (pageNumber) {
      // "Ask about this page": use the stored page text, never client-supplied content.
      const page = await this.deps.documents.getPage(book.id, pageNumber);
      if (page?.content) return { text: page.content.slice(0, MAX_SELECTION_CHARS), pageNumber };
    }
    return null;
  }

  async *stream(prepared: PreparedChat, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    const { book, conversation, message, selection } = prepared;
    const log = logger.child({ bookId: book.id, conversationId: conversation.id });
    const started = performance.now();

    const history = prepared.isNewConversation
      ? []
      : await this.deps.conversations.recentHistory(conversation.id, HISTORY_MESSAGES);

    const metadata: MessageMetadata = {
      ...(selection ? { selection } : {}),
      ...(prepared.scopeChapterId ? { scope: { chapterId: prepared.scopeChapterId } } : {}),
    };
    const userMessage = await this.deps.conversations.insertMessage({
      conversationId: conversation.id,
      role: "user",
      content: message,
      metadata,
    });

    const summary: ConversationSummary = {
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: userMessage.createdAt.toISOString(),
      messageCount: history.length + 1,
    };
    yield { type: "conversation", conversation: summary, userMessage: toMessageDTO({ ...userMessage, sources: [] }) };

    let answerSoFar = "";
    let context: BuiltContext | null = null;
    let analysis: QueryAnalysis | null = null;
    let retrievalQuery = message;
    let resolvedQuestion: string | null = null;

    try {
      // 1. Understand the question.
      yield { type: "status", stage: "understanding" };
      analysis = analyzeQuery(message, prepared.chapters);
      if (history.length > 0 && analysis.looksLikeFollowUp && !selection) {
        const rewrite = await this.deps.rewriter.rewrite(message, history);
        if (rewrite.rewritten) {
          retrievalQuery = rewrite.query;
          resolvedQuestion = rewrite.byModel ? rewrite.query : null;
          const rewrittenAnalysis = analyzeQuery(rewrite.query, prepared.chapters);
          analysis = {
            ...analysis,
            type: analysis.type === "factual" ? rewrittenAnalysis.type : analysis.type,
            chapterIds: [...new Set([...analysis.chapterIds, ...rewrittenAnalysis.chapterIds])],
            mentionedChapterIds: [...new Set([...analysis.mentionedChapterIds, ...rewrittenAnalysis.mentionedChapterIds])],
            keywords: [...new Set([...analysis.keywords, ...rewrittenAnalysis.keywords])],
          };
        }
      }
      if (selection) retrievalQuery = `${retrievalQuery}\n\n${selection.text.slice(0, 600)}`;

      // Page references ("page 42") use printed labels when the PDF has them.
      let pageRange: { from: number; to: number } | undefined;
      if (analysis.pageNumbers.length > 0) {
        const resolved = await Promise.all(
          analysis.pageNumbers.map(
            async (n) => (await this.deps.documents.resolvePageLabel(book.id, String(n))) ?? n,
          ),
        );
        pageRange = { from: Math.min(...resolved), to: Math.max(...resolved) };
      }

      // 2. Retrieve and rerank.
      yield { type: "status", stage: "retrieving" };
      const retrievalStarted = performance.now();
      const result = await this.deps.retrieval.retrieve({
        bookId: book.id,
        query: retrievalQuery,
        analysis,
        filters: {
          ...(prepared.scopeChapterId ? { chapterIds: [prepared.scopeChapterId] } : {}),
          ...(pageRange ? { pageRange } : {}),
        },
        anchorPages: selection?.pageNumber ? { from: selection.pageNumber, to: selection.pageNumber } : undefined,
      });
      const ranked = await this.deps.reranker.rerank({
        query: retrievalQuery,
        analysis,
        candidates: result.candidates,
        topK: topKForQuery(analysis, this.deps.retrievalConfig.topK),
        minSimilarity: this.deps.retrievalConfig.minSimilarity ?? 0,
      });
      context = buildContext(ranked, { maxTokens: this.deps.retrievalConfig.contextMaxTokens });

      const labels = await this.deps.documents.pageLabels(
        book.id,
        context.sources.map((source) => source.snapshot.pageStart),
      );
      for (const source of context.sources) source.snapshot.pageLabel = labels.get(source.snapshot.pageStart) ?? null;
      const retrievalMs = Math.round(performance.now() - retrievalStarted);

      yield { type: "sources", sources: context.sources.map((source) => this.sourceDTO(source, false)) };

      // 3. Generate.
      yield { type: "status", stage: "generating" };
      let done: { answer: string; cited: string[]; model: string | null; usage?: MessageMetadata["usage"]; noContext: boolean; latencyMs: number } | null = null;
      for await (const event of this.deps.rag.stream({
        book: { title: book.title, author: book.author },
        question: message,
        resolvedQuestion,
        queryType: analysis.type,
        context,
        history,
        selection,
        signal,
      })) {
        if (event.type === "delta") {
          answerSoFar += event.text;
          yield { type: "delta", text: event.text };
        } else {
          done = {
            answer: event.answer,
            cited: event.citations.cited,
            model: event.model,
            usage: event.usage,
            noContext: event.noContext,
            latencyMs: event.latencyMs,
          };
        }
      }
      if (!done) throw new Error("Answer stream ended without completion");

      // 4. Persist the answer with its sources (cited flags come from validated markers).
      const cited = new Set(done.cited);
      const saved = await this.deps.conversations.insertAnswer(
        {
          conversationId: conversation.id,
          content: done.answer,
          status: "complete",
          metadata: {
            queryType: analysis.type,
            retrievalQuery: retrievalQuery !== message ? truncate(retrievalQuery, 500) : undefined,
            model: done.model ?? undefined,
            usage: done.usage,
            noContext: done.noContext,
            latencyMs: { retrieval: retrievalMs, generation: done.latencyMs, total: Math.round(performance.now() - started) },
          },
        },
        this.toSourceRows(context, cited),
      );
      log.info("chat.answered", {
        queryType: analysis.type,
        strategy: result.strategy,
        sources: context.sources.length,
        cited: cited.size,
        noContext: done.noContext,
        totalMs: Math.round(performance.now() - started),
      });
      yield { type: "done", message: toMessageDTO(saved) };
    } catch (error) {
      if (signal?.aborted) {
        // The reader pressed stop (or left): keep whatever was written so far.
        if (answerSoFar.trim() && context) {
          await this.deps.conversations
            .insertAnswer(
              {
                conversationId: conversation.id,
                content: answerSoFar.trim(),
                status: "complete",
                metadata: { queryType: analysis?.type },
              },
              this.toSourceRows(context, new Set()),
            )
            .catch((e) => log.warn("chat.partial_save_failed", { error: e }));
        }
        log.info("chat.aborted", { partialChars: answerSoFar.length });
        return;
      }

      log.error("chat.failed", { error });
      const userMessageText = isAppError(error) ? error.userMessage : toUserMessage(error);
      await this.deps.conversations
        .insertAnswer(
          { conversationId: conversation.id, content: userMessageText, status: "error", metadata: { queryType: analysis?.type } },
          [],
        )
        .catch((e) => log.warn("chat.error_save_failed", { error: e }));
      yield { type: "error", code: isAppError(error) ? error.code : "internal_error", message: userMessageText };
    }
  }

  private sourceDTO(source: BuiltContext["sources"][number], cited: boolean): SourceDTO {
    return {
      label: source.label,
      rank: source.rank,
      chunkId: source.chunk.id,
      cited,
      score: source.chunk.score,
      chapterTitle: source.snapshot.chapterTitle,
      chapterLabel: source.snapshot.chapterLabel,
      chapterNumber: source.snapshot.chapterNumber,
      sectionTitle: source.snapshot.sectionTitle,
      pageStart: source.snapshot.pageStart,
      pageEnd: source.snapshot.pageEnd,
      pageLabel: source.snapshot.pageLabel,
      excerpt: source.snapshot.excerpt,
    };
  }

  private toSourceRows(context: BuiltContext, cited: Set<string>): NewMessageSource[] {
    return context.sources.map((source) => ({
      chunkId: source.chunk.id,
      rank: source.rank,
      similarityScore: source.chunk.semanticScore,
      keywordScore: source.chunk.keywordScore,
      score: source.chunk.score,
      cited: cited.has(source.label),
      snapshot: source.snapshot,
    }));
  }
}
