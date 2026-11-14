/**
 * Shapes stored in JSONB columns and shared between server and client.
 */

export const BOOK_STATUSES = ["UPLOADING", "PROCESSING", "READY", "FAILED"] as const;
export type BookStatus = (typeof BOOK_STATUSES)[number];

/**
 * Fine-grained ingestion stages. These are written by the worker as it
 * actually progresses, and are what the processing UI renders.
 */
export const PROCESSING_STAGES = [
  "QUEUED",
  "EXTRACTING",
  "DETECTING_STRUCTURE",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "COMPLETE",
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

export interface ProcessingProgress {
  completed: number;
  total: number;
}

/** A structural block of a cleaned page, as rendered by the reader. */
export interface PageBlock {
  type: "heading" | "paragraph" | "break";
  text: string;
  /** Heading level (1 = chapter heading, 2 = section heading). */
  level?: 1 | 2;
  /** Sequential chapter number (1-based) this block belongs to, if any. */
  chapterNumber?: number | null;
  /** Nearest section heading within the chapter. */
  sectionTitle?: string | null;
  /** Paragraph continues from the previous page (split by a page break). */
  continuation?: boolean;
}

export interface ChunkMetadata {
  chapterTitle?: string | null;
  chapterLabel?: string | null;
  sectionTitle?: string | null;
  /** Every heading covered by this chunk (small sections can be merged). */
  headings?: string[];
  paragraphCount?: number;
  /** Characters at the start of `content` repeated from the previous chunk. */
  overlapChars?: number;
  overlapTokens?: number;
}

export type SuggestionCategory = "understand" | "explore" | "compare" | "reflect";

export interface SuggestedQuestion {
  category: SuggestionCategory;
  question: string;
}

export interface BookInsights {
  keywords: string[];
  people: string[];
  suggestedQuestions: SuggestedQuestion[];
  generatedBy: "heuristic" | "llm";
}

export const QUERY_TYPES = [
  "factual",
  "conceptual",
  "summarization",
  "comparison",
  "character",
  "theme",
  "quote",
  "chapter",
  "broad",
] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface MessageSelection {
  text: string;
  pageNumber?: number;
}

export interface MessageMetadata {
  selection?: MessageSelection;
  scope?: { chapterId?: string | null };
  queryType?: QueryType;
  retrievalQuery?: string;
  model?: string;
  usage?: TokenUsage;
  latencyMs?: { retrieval?: number; generation?: number; total?: number };
  noContext?: boolean;
}

/**
 * Immutable record of exactly what was shown to the model and the user for a
 * citation. Survives reprocessing of the book (chunk rows are replaced).
 */
export interface SourceSnapshot {
  chapterTitle: string | null;
  chapterLabel: string | null;
  chapterNumber: number | null;
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  pageLabel: string | null;
  excerpt: string;
  content: string;
}
