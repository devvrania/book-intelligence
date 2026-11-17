import type { Book, Chapter, MessageSource } from "@/lib/db/schema";
import type { BookListRow } from "@/server/repositories/book-repository";
import type { MessageWithSources } from "@/server/repositories/conversation-repository";
import type { BookDetail, BookSummary, ChapterSummary, MessageDTO, SourceDTO } from "@/types/api";
import { cleanAuthor } from "@/lib/documents/structure-detector";

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

/** Files are served through authenticated routes, never public bucket URLs. */
export function coverUrlFor(book: Pick<Book, "id" | "coverKey" | "updatedAt">) {
  return book.coverKey ? `/api/books/${book.id}/cover?v=${book.updatedAt.getTime()}` : null;
}

export function toBookSummary(book: BookListRow | Book): BookSummary {
  return {
    id: book.id,
    title: book.title,
    // cleaned on the way out too, so books processed before author cleaning display a proper name
    author: cleanAuthor(book.author),
    coverUrl: coverUrlFor(book),
    pageCount: book.pageCount,
    chunkCount: book.chunkCount,
    status: book.status,
    processingStage: book.processingStage,
    processingProgress: book.processingProgress,
    processingError: book.processingError,
    lastOpenedAt: iso(book.lastOpenedAt),
    createdAt: book.createdAt.toISOString(),
    updatedAt: book.updatedAt.toISOString(),
  };
}

export function toChapterSummary(chapter: Chapter): ChapterSummary {
  return {
    id: chapter.id,
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    label: chapter.label,
    startPage: chapter.startPage,
    endPage: chapter.endPage,
  };
}

export function toBookDetail(book: Book, chapters: Chapter[]): BookDetail {
  return {
    ...toBookSummary(book),
    description: book.description,
    originalFilename: book.originalFilename,
    fileSize: book.fileSize,
    wordCount: book.wordCount,
    fileUrl: book.fileKey ? `/api/books/${book.id}/file` : null,
    embeddingModel: book.embeddingModel,
    insights: book.insights,
    processedAt: iso(book.processedAt),
    chapters: chapters.map(toChapterSummary),
  };
}

export function toSourceDTO(source: Pick<MessageSource, "rank" | "chunkId" | "cited" | "score" | "snapshot">): SourceDTO {
  return {
    label: `S${source.rank}`,
    rank: source.rank,
    chunkId: source.chunkId,
    cited: source.cited,
    score: source.score,
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

export function toMessageDTO(message: MessageWithSources): MessageDTO {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    sources: message.sources.map(toSourceDTO),
    selection: message.metadata?.selection ?? null,
    queryType: message.metadata?.queryType ?? null,
    noContext: message.metadata?.noContext ?? false,
    grounding: message.metadata?.grounding ?? null,
  };
}
