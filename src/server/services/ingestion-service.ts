import { AIProviderError } from "@/lib/ai";
import type { ChunkingService } from "@/lib/documents/chunking-service";
import { renderCover, type DocumentProcessor } from "@/lib/documents/document-processor";
import { titleFromFilename } from "@/lib/documents/structure-detector";
import { DocumentError } from "@/lib/documents/types";
import type { EmbeddingService } from "@/lib/embeddings/embedding-service";
import { isAppError } from "@/lib/errors";
import type { JobContext, JobHandler } from "@/lib/jobs/types";
import { logger } from "@/lib/logger";
import { storageKeys, type StorageProvider } from "@/lib/storage";
import type { BookRepository } from "@/server/repositories/book-repository";
import type { DocumentRepository } from "@/server/repositories/document-repository";

import type { InsightsService } from "./insights-service";

export interface IngestionDeps {
  books: BookRepository;
  documents: DocumentRepository;
  storage: StorageProvider;
  embeddings: EmbeddingService;
  processor: DocumentProcessor;
  chunking: ChunkingService;
  insights: InsightsService;
  embeddingBatchSize: number;
  maxPages?: number;
  renderCovers?: boolean;
}

const INGESTION_FAILED_MESSAGE = "Something went wrong while preparing this book. You can try processing it again.";

/**
 * Book ingestion pipeline, run by the background worker:
 *
 *   extract → detect structure → chunk → embed → index → READY
 *
 * Every stage is checkpointed in the database (pages, chunks, embeddings), so
 * a retry after a transient failure resumes where it stopped instead of
 * re-paying for embeddings. Stage changes are written to the book row as they
 * happen; that is what the processing UI displays.
 */
export class IngestionService implements JobHandler<"ingest_book"> {
  constructor(private readonly deps: IngestionDeps) {}

  async run({ bookId }: { bookId: string }, context: JobContext): Promise<void> {
    const { books, documents, storage, embeddings, processor, chunking } = this.deps;
    const log = logger.child({ bookId, jobId: context.jobId, attempt: context.attempt });
    const started = performance.now();

    const book = await books.findById(bookId);
    if (!book) {
      log.warn("ingestion.book_missing");
      return; // deleted while queued — nothing to do
    }
    if (!book.fileKey) throw new DocumentError("invalid_pdf", { message: "Book has no stored file" });

    // 1–2. Extract text and detect structure (skipped when resuming).
    let pageCount = await documents.countPages(bookId);
    if (pageCount === 0) {
      await books.setStage(bookId, "EXTRACTING");
      const data = await storage.getBuffer(book.fileKey);
      const doc = await processor.process(data, {
        filename: book.originalFilename,
        maxPages: this.deps.maxPages,
        onStage: (stage) => books.setStage(bookId, stage),
      });
      await documents.replaceStructure(bookId, doc);

      let coverKey = book.coverKey;
      if (!coverKey && this.deps.renderCovers !== false) {
        const cover = await renderCover(data);
        if (cover) {
          coverKey = storageKeys.bookCover(bookId);
          await storage.put(coverKey, cover, { contentType: "image/png" });
        }
      }

      // Keep user edits; replace the filename-derived placeholder title with the detected one.
      const placeholderTitle = book.title === titleFromFilename(book.originalFilename);
      await books.update(bookId, {
        title: placeholderTitle && doc.title ? doc.title : book.title,
        author: book.author ?? doc.author,
        description: book.description ?? doc.description,
        pageCount: doc.pageCount,
        wordCount: doc.wordCount,
        coverKey,
      });
      pageCount = doc.pageCount;
      log.info("ingestion.structure_stored", { pages: doc.pageCount, chapters: doc.chapters.length });
    }

    // 3. Chunk.
    let { total, embedded } = await documents.countChunks(bookId);
    if (total === 0) {
      await books.setStage(bookId, "CHUNKING");
      const [pages, chapterRows] = await Promise.all([documents.loadStructuredPages(bookId), documents.listChapters(bookId)]);
      const drafts = chunking.chunk(pages, chapterRows);
      if (drafts.length === 0) throw new DocumentError("no_text", { message: "Chunker produced no chunks" });
      await documents.insertChunks(bookId, drafts);
      total = drafts.length;
      embedded = 0;
      log.info("ingestion.chunked", {
        chunks: total,
        avgTokens: Math.round(drafts.reduce((sum, d) => sum + d.tokenCount, 0) / total),
      });
    }

    // 4. Embed, in resumable batches.
    const current = (await books.findById(bookId)) ?? book;
    await books.setStage(bookId, "EMBEDDING", { completed: embedded, total });
    const embedStarted = performance.now();
    for (;;) {
      const batch = await documents.nextChunksToEmbed(bookId, this.deps.embeddingBatchSize);
      if (batch.length === 0) break;
      const vectors = await embeddings.embedChunks(
        batch.map((chunk) => ({
          content: chunk.content,
          bookTitle: current.title,
          chapterTitle: chunk.metadata.chapterTitle,
          chapterLabel: chunk.metadata.chapterLabel,
          sectionTitle: chunk.sectionTitle,
        })),
      );
      await documents.setEmbeddings(batch.map((chunk, i) => ({ id: chunk.id, embedding: vectors[i] })));
      embedded += batch.length;
      await books.setStage(bookId, "EMBEDDING", { completed: Math.min(embedded, total), total });
    }
    log.info("ingestion.embedded", { chunks: total, model: embeddings.model, durationMs: Math.round(performance.now() - embedStarted) });

    // 5. Index statistics and per-book insights.
    await books.setStage(bookId, "INDEXING");
    await documents.analyzeChunks();
    const [pages, chapterRows] = await Promise.all([documents.loadStructuredPages(bookId), documents.listChapters(bookId)]);
    const text = pages.map((page) => page.content).join("\n\n");
    const { insights, description } = await this.deps.insights.generate({
      title: current.title,
      author: current.author,
      chapters: chapterRows,
      text,
      opening: text.slice(0, 12_000),
    });

    await books.update(bookId, {
      status: "READY",
      processingStage: "COMPLETE",
      processingProgress: null,
      processingError: null,
      chunkCount: total,
      embeddingModel: embeddings.model,
      insights,
      description: current.description ?? description,
      processedAt: new Date(),
    });

    log.info("ingestion.completed", {
      durationMs: Math.round(performance.now() - started),
      pages: pageCount,
      chunks: total,
      insights: insights.generatedBy,
    });
  }

  isRetryable(error: unknown): boolean {
    if (error instanceof DocumentError) return false;
    if (error instanceof AIProviderError) return error.retryable;
    return true;
  }

  async onFailure({ bookId }: { bookId: string }, error: unknown): Promise<void> {
    const message = isAppError(error) ? error.userMessage : INGESTION_FAILED_MESSAGE;
    await this.deps.books.update(bookId, { status: "FAILED", processingError: message, processingProgress: null });
    logger.warn("ingestion.failed", { bookId, error });
  }
}
