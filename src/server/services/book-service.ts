import { looksLikePdf } from "@/lib/documents/pdf-signature";
import { titleFromFilename } from "@/lib/documents/structure-detector";
import {
  ConflictError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from "@/lib/errors";
import type { JobQueue } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { storageKeys, type StorageProvider, type StoredObject } from "@/lib/storage";
import type { BookRepository, ListBooksOptions } from "@/server/repositories/book-repository";
import type { DocumentRepository } from "@/server/repositories/document-repository";
import type { BookDetail, BookListResponse, BookSummary, PageDTO, PassageDTO } from "@/types/api";

import { toBookDetail, toBookSummary } from "./mappers";

export interface BookServiceDeps {
  books: BookRepository;
  documents: DocumentRepository;
  storage: StorageProvider;
  queue: JobQueue;
  maxUploadBytes: number;
}

/** Display-safe version of a client-supplied filename. It is never used as a storage path. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  return base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, "").trim().slice(0, 200);
}

/**
 * Library management. Every method takes the authenticated user's id (from
 * the server-side session) and only ever touches that user's books; other
 * users' books are indistinguishable from missing ones (404).
 */
export class BookService {
  constructor(private readonly deps: BookServiceDeps) {}

  private async requireBook(bookId: string) {
    const book = await this.deps.books.findById(bookId);
    if (!book) throw new NotFoundError("Book");
    return book;
  }

  async list(options: ListBooksOptions): Promise<BookListResponse> {
    const { items, total } = await this.deps.books.list(options);
    return { items: items.map(toBookSummary), total };
  }

  async get(bookId: string): Promise<BookDetail> {
    const book = await this.requireBook(bookId);
    const chapters = await this.deps.documents.listChapters(bookId);
    return toBookDetail(book, chapters);
  }

  async getSummary(bookId: string): Promise<BookSummary> {
    return toBookSummary(await this.requireBook(bookId));
  }

  /** Step 1 of an upload: create the Book record immediately (status UPLOADING). */
  async create(input: { filename: string; fileSize: number }): Promise<BookSummary> {
    const filename = sanitizeFilename(input.filename);
    if (!/\.pdf$/i.test(filename)) throw new UnsupportedMediaTypeError("Only PDF files are supported.");
    this.assertSize(input.fileSize);

    const book = await this.deps.books.create({
      title: titleFromFilename(filename) ?? "Untitled book",
      originalFilename: filename,
      fileSize: input.fileSize,
      status: "UPLOADING",
    });
    logger.info("books.created", { bookId: book.id, fileSize: input.fileSize });
    return toBookSummary(book);
  }

  /** Step 2: store the file and enqueue processing. */
  async upload(bookId: string, data: Uint8Array): Promise<BookSummary> {
    const book = await this.requireBook(bookId);
    if (book.status !== "UPLOADING" && book.status !== "FAILED") {
      throw new ConflictError("This book has already been uploaded.");
    }
    this.assertSize(data.byteLength);
    if (!looksLikePdf(data)) {
      throw new UnsupportedMediaTypeError("This file doesn't look like a PDF. Please upload a .pdf file.");
    }

    const fileKey = storageKeys.bookFile(bookId);
    await this.deps.storage.put(fileKey, data, { contentType: "application/pdf" });
    await this.deps.documents.clearDerived(bookId);
    const updated = await this.deps.books.update(bookId, {
      fileKey,
      fileSize: data.byteLength,
      status: "PROCESSING",
      processingStage: "QUEUED",
      processingProgress: null,
      processingError: null,
    });
    await this.deps.queue.enqueue("ingest_book", { bookId }, { bookId });
    logger.info("books.uploaded", { bookId, bytes: data.byteLength });
    return toBookSummary(updated!);
  }

  async reprocess(bookId: string): Promise<BookSummary> {
    const book = await this.requireBook(bookId);
    if (!book.fileKey) throw new ConflictError("Upload the PDF before processing it.");
    if (book.status === "PROCESSING") throw new ConflictError("This book is already being processed.");

    await this.deps.documents.clearDerived(bookId);
    const updated = await this.deps.books.update(bookId, {
      status: "PROCESSING",
      processingStage: "QUEUED",
      processingProgress: null,
      processingError: null,
      chunkCount: 0,
    });
    await this.deps.queue.enqueue("ingest_book", { bookId }, { bookId });
    return toBookSummary(updated!);
  }

  async update(
    bookId: string,
    input: { title?: string; author?: string | null; description?: string | null },
  ): Promise<BookSummary> {
    await this.requireBook(bookId);
    const updated = await this.deps.books.update(bookId, input);
    return toBookSummary(updated!);
  }

  async delete(bookId: string): Promise<void> {
    const book = await this.deps.books.delete(bookId);
    if (!book) throw new NotFoundError("Book");
    // DB rows cascade; files are removed best-effort (an orphaned file is harmless), from the folder the book's
    // file was saved in.
    const prefix = book.fileKey?.replace(/[^/]+$/, "") || storageKeys.bookPrefix(bookId);
    await this.deps.storage
      .deletePrefix(prefix)
      .catch((error) => logger.warn("books.storage_cleanup_failed", { bookId, error }));
    logger.info("books.deleted", { bookId });
  }

  async markOpened(bookId: string): Promise<void> {
    await this.deps.books.markOpened(bookId);
  }

  async getPage(bookId: string, pageNumber: number): Promise<PageDTO> {
    const book = await this.requireBook(bookId);
    const page = await this.deps.documents.getPage(bookId, pageNumber);
    if (!page) throw new NotFoundError("Page");
    const chapter = page.chapterId
      ? (await this.deps.documents.listChapters(bookId)).find((c) => c.id === page.chapterId)
      : undefined;
    return {
      pageNumber: page.pageNumber,
      pageLabel: page.pageLabel,
      pageCount: book.pageCount ?? page.pageNumber,
      chapter: chapter
        ? { id: chapter.id, title: chapter.title, label: chapter.label, chapterNumber: chapter.chapterNumber }
        : null,
      blocks: page.blocks,
    };
  }

  async getPassage(bookId: string, chunkId: string): Promise<PassageDTO> {
    await this.requireBook(bookId);
    const chunk = await this.deps.documents.getChunkWithContext(bookId, chunkId);
    if (!chunk) throw new NotFoundError("Passage");
    return {
      chunkId: chunk.id,
      content: chunk.content,
      overlapChars: chunk.metadata?.overlapChars ?? 0,
      chapterTitle: chunk.chapterTitle,
      chapterLabel: chunk.chapterLabel,
      chapterNumber: chunk.chapterNumber,
      sectionTitle: chunk.sectionTitle,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
    };
  }

  async openFile(bookId: string): Promise<{ object: StoredObject; filename: string }> {
    const book = await this.requireBook(bookId);
    if (!book.fileKey) throw new NotFoundError("File");
    const object = await this.deps.storage.getStream(book.fileKey);
    if (!object) throw new NotFoundError("File");
    return { object, filename: book.originalFilename ?? "book.pdf" };
  }

  async openCover(bookId: string): Promise<StoredObject> {
    const book = await this.requireBook(bookId);
    if (!book.coverKey) throw new NotFoundError("Cover");
    const object = await this.deps.storage.getStream(book.coverKey);
    if (!object) throw new NotFoundError("Cover");
    return object;
  }

  private assertSize(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) throw new ValidationError("The file is empty.");
    if (bytes > this.deps.maxUploadBytes) {
      throw new PayloadTooLargeError(
        `This file is too large. The maximum size is ${Math.round(this.deps.maxUploadBytes / 1024 / 1024)} MB.`,
      );
    }
  }
}
