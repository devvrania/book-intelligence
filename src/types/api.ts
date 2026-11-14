import type {
  BookInsights,
  BookStatus,
  PageBlock,
  ProcessingProgress,
  ProcessingStage,
  QueryType,
} from "./domain";

/**
 * JSON shapes exchanged between the API and the client. Dates are ISO strings.
 */

export interface BookSummary {
  id: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  pageCount: number | null;
  chunkCount: number;
  status: BookStatus;
  processingStage: ProcessingStage | null;
  processingProgress: ProcessingProgress | null;
  processingError: string | null;
  lastOpenedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterSummary {
  id: string;
  chapterNumber: number;
  title: string;
  label: string | null;
  startPage: number;
  endPage: number;
}

export interface BookDetail extends BookSummary {
  description: string | null;
  originalFilename: string | null;
  fileSize: number | null;
  wordCount: number | null;
  fileUrl: string | null;
  embeddingModel: string | null;
  insights: BookInsights | null;
  processedAt: string | null;
  chapters: ChapterSummary[];
}

export interface BookListResponse {
  items: BookSummary[];
  total: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface SourceDTO {
  label: string;
  rank: number;
  chunkId: string | null;
  cited: boolean;
  score: number;
  chapterTitle: string | null;
  chapterLabel: string | null;
  chapterNumber: number | null;
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  /** Printed page label of pageStart, when the PDF defines one. */
  pageLabel: string | null;
  excerpt: string;
}

export interface MessageDTO {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: "complete" | "error";
  createdAt: string;
  sources: SourceDTO[];
  selection?: { text: string; pageNumber?: number } | null;
  queryType?: QueryType | null;
  noContext?: boolean;
}

export type ChatStreamEvent =
  | { type: "conversation"; conversation: ConversationSummary; userMessage: MessageDTO }
  | { type: "status"; stage: "understanding" | "retrieving" | "generating" }
  | { type: "sources"; sources: SourceDTO[] }
  | { type: "delta"; text: string }
  | { type: "done"; message: MessageDTO }
  | { type: "error"; code: string; message: string };

export interface ChatRequestBody {
  message: string;
  conversationId?: string | null;
  chapterId?: string | null;
  selection?: { text?: string | null; pageNumber?: number | null } | null;
}

export interface PageDTO {
  pageNumber: number;
  pageLabel: string | null;
  pageCount: number;
  chapter: { id: string; title: string; label: string | null; chapterNumber: number } | null;
  blocks: PageBlock[];
}

export interface PassageDTO {
  chunkId: string;
  content: string;
  overlapChars: number;
  chapterTitle: string | null;
  chapterLabel: string | null;
  chapterNumber: number | null;
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
