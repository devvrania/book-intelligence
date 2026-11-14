import { AppError } from "@/lib/errors";
import type { ChunkMetadata, PageBlock } from "@/types/domain";

/* ------------------------------- Extraction ------------------------------- */

export interface PdfTextLine {
  text: string;
  /** Left edge in PDF units. */
  x: number;
  /** Baseline distance from the top of the page, in PDF units. */
  top: number;
  width: number;
  fontSize: number;
}

export interface ExtractedPage {
  pageNumber: number;
  width: number;
  height: number;
  lines: PdfTextLine[];
}

export interface OutlineEntry {
  title: string;
  pageNumber: number;
  depth: number;
}

export interface ExtractedDocument {
  pageCount: number;
  info: { title?: string; author?: string; subject?: string };
  outline: OutlineEntry[];
  pageLabels: string[] | null;
  pages: ExtractedPage[];
}

/* -------------------------------- Cleaning -------------------------------- */

export interface CleanBlock {
  type: "heading" | "paragraph" | "break";
  text: string;
  fontSize: number;
  continuation?: boolean;
  /** Internal: whether the paragraph's first line is indented (used to detect page-break continuations). */
  indented?: boolean;
}

export interface CleanPage {
  pageNumber: number;
  pageLabel: string | null;
  blocks: CleanBlock[];
}

export interface CleanDocument {
  pages: CleanPage[];
  bodyFontSize: number;
  stats: { removedBoilerplateLines: number; removedPageNumbers: number };
}

/* -------------------------------- Structure ------------------------------- */

export interface DetectedChapter {
  /** Sequential, 1-based. */
  chapterNumber: number;
  title: string;
  label: string | null;
  labelNumber: number | null;
  startPage: number;
  endPage: number;
}

export interface StructuredPage {
  pageNumber: number;
  pageLabel: string | null;
  chapterNumber: number | null;
  blocks: PageBlock[];
  content: string;
  wordCount: number;
}

export interface StructuredDocument {
  title: string | null;
  author: string | null;
  description: string | null;
  pageCount: number;
  wordCount: number;
  chapterSource: "outline" | "headings" | "none";
  chapters: DetectedChapter[];
  pages: StructuredPage[];
}

/* -------------------------------- Chunking -------------------------------- */

export interface ChunkDraft {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
  chapterNumber: number | null;
  sectionTitle: string | null;
  metadata: ChunkMetadata;
}

/* --------------------------------- Errors --------------------------------- */

export type DocumentErrorKind = "invalid_pdf" | "encrypted" | "no_text" | "too_many_pages";

const DOCUMENT_ERROR_MESSAGES: Record<DocumentErrorKind, string> = {
  invalid_pdf: "This file doesn't appear to be a valid PDF, or it may be corrupted.",
  encrypted: "This PDF is password-protected. Please upload an unlocked copy.",
  no_text:
    "We couldn't find selectable text in this PDF. It may be a scanned book — text recognition (OCR) isn't supported yet.",
  too_many_pages: "This PDF has more pages than we can process right now.",
};

/** A problem with the document itself. Never retried. */
export class DocumentError extends AppError {
  readonly kind: DocumentErrorKind;

  constructor(kind: DocumentErrorKind, options: { cause?: unknown; message?: string } = {}) {
    super(`document_${kind}`, 422, DOCUMENT_ERROR_MESSAGES[kind], options);
    this.kind = kind;
  }
}
