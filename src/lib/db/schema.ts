import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

import {
  BOOK_STATUSES,
  PROCESSING_STAGES,
  type BookInsights,
  type ChunkMetadata,
  type MessageMetadata,
  type PageBlock,
  type ProcessingProgress,
  type SourceSnapshot,
} from "@/types/domain";

/**
 * Dimension of the pgvector column. Must match EMBEDDING_DIMENSIONS.
 * Changing it requires a new migration and re-embedding every book.
 * (HNSW indexes support up to 2,000 dimensions for `vector`.)
 */
export const VECTOR_DIMENSIONS = 1536;

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/*                                   Library                                   */
/* -------------------------------------------------------------------------- */

export const bookStatus = pgEnum("book_status", BOOK_STATUSES);
export const processingStage = pgEnum("processing_stage", PROCESSING_STAGES);

export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    originalFilename: text("original_filename"),
    /** Object-storage key of the original PDF (never a public URL). */
    fileKey: text("file_key"),
    fileSize: integer("file_size"),
    /** Object-storage key of the rendered cover image, if any. */
    coverKey: text("cover_key"),
    pageCount: integer("page_count"),
    wordCount: integer("word_count"),
    chunkCount: integer("chunk_count").notNull().default(0),
    status: bookStatus("status").notNull().default("UPLOADING"),
    processingStage: processingStage("processing_stage"),
    processingProgress: jsonb("processing_progress").$type<ProcessingProgress>(),
    /** User-facing failure message (never an internal stack trace). */
    processingError: text("processing_error"),
    /** Embedding model used for this book's vectors; queries must match it. */
    embeddingModel: text("embedding_model"),
    insights: jsonb("insights").$type<BookInsights>(),
    lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("books_updated_idx").on(t.updatedAt.desc()),
    index("books_last_opened_idx").on(t.lastOpenedAt.desc()),
    index("books_status_idx").on(t.status),
  ],
);

export const chapters = pgTable(
  "chapters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Sequential position in the book (1-based). */
    chapterNumber: integer("chapter_number").notNull(),
    /** The book's own label, e.g. "Chapter IV" or "Part Two". */
    label: text("label"),
    /** Numeric value of the label ("Chapter IV" → 4), used to resolve "chapter 4". */
    labelNumber: integer("label_number"),
    startPage: integer("start_page").notNull(),
    endPage: integer("end_page").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chapters_book_number_idx").on(t.bookId, t.chapterNumber),
    index("chapters_book_start_page_idx").on(t.bookId, t.startPage),
  ],
);

export const documentPages = pgTable(
  "document_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    /** Physical 1-based page index in the PDF. */
    pageNumber: integer("page_number").notNull(),
    /** Printed page label from the PDF ("xii", "184"), when available. */
    pageLabel: text("page_label"),
    /** Cleaned plain text (paragraphs separated by blank lines). */
    content: text("content").notNull(),
    blocks: jsonb("blocks").$type<PageBlock[]>().notNull().default([]),
    wordCount: integer("word_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_pages_book_page_idx").on(t.bookId, t.pageNumber),
    index("document_pages_chapter_idx").on(t.chapterId),
  ],
);

export const documentChunks = pgTable(
  "document_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
    /** The page where this chunk starts. */
    pageId: uuid("page_id").references(() => documentPages.id, { onDelete: "set null" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull(),
    pageStart: integer("page_start").notNull(),
    pageEnd: integer("page_end").notNull(),
    sectionTitle: text("section_title"),
    metadata: jsonb("metadata").$type<ChunkMetadata>().notNull().default({}),
    embedding: vector("embedding", { dimensions: VECTOR_DIMENSIONS }),
    /**
     * Chapter/section titles are weighted higher (A) than body text (B) so
     * keyword search favours passages from an explicitly matching section.
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce("metadata"->>'chapterTitle', '') || ' ' || coalesce("section_title", '')), 'A') || setweight(to_tsvector('english', "content"), 'B')`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("document_chunks_book_index_idx").on(t.bookId, t.chunkIndex),
    index("document_chunks_chapter_idx").on(t.chapterId),
    index("document_chunks_page_idx").on(t.pageId),
    index("document_chunks_book_pages_idx").on(t.bookId, t.pageStart, t.pageEnd),
    index("document_chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("document_chunks_search_idx").using("gin", t.searchVector),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                Conversations                                */
/* -------------------------------------------------------------------------- */

export const messageRole = pgEnum("message_role", ["user", "assistant"]);
export const messageStatus = pgEnum("message_status", ["complete", "error"]);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("conversations_book_last_message_idx").on(t.bookId, t.lastMessageAt.desc())],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    status: messageStatus("status").notNull().default("complete"),
    metadata: jsonb("metadata").$type<MessageMetadata>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_created_idx").on(t.conversationId, t.createdAt)],
);

export const messageSources = pgTable(
  "message_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    /** Null once the book is reprocessed; the snapshot keeps the citation intact. */
    chunkId: uuid("chunk_id").references(() => documentChunks.id, { onDelete: "set null" }),
    /** Label number shown to the model and the user ([S1] → 1). */
    rank: integer("rank").notNull(),
    similarityScore: real("similarity_score"),
    keywordScore: real("keyword_score"),
    score: real("score").notNull(),
    /** Whether the answer actually cited this source. */
    cited: boolean("cited").notNull().default(false),
    snapshot: jsonb("snapshot").$type<SourceSnapshot>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("message_sources_message_rank_idx").on(t.messageId, t.rank),
    index("message_sources_chunk_idx").on(t.chunkId),
  ],
);

/* -------------------------------------------------------------------------- */
/*                                Infrastructure                               */
/* -------------------------------------------------------------------------- */

export const jobStatus = pgEnum("job_status", ["queued", "running", "completed", "failed"]);

export const processingJobs = pgTable(
  "processing_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "cascade" }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastError: text("last_error"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("processing_jobs_claim_idx").on(t.status, t.runAt),
    index("processing_jobs_book_idx").on(t.bookId),
    // At most one active job of each type per book.
    uniqueIndex("processing_jobs_active_book_idx")
      .on(t.bookId, t.type)
      .where(sql`status in ('queued', 'running')`),
  ],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type DocumentPage = typeof documentPages.$inferSelect;
export type DocumentChunk = typeof documentChunks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageSource = typeof messageSources.$inferSelect;
export type ProcessingJob = typeof processingJobs.$inferSelect;
