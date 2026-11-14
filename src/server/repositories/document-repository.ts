import { and, asc, count, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";

import { toVectorLiteral, type Database } from "@/lib/db/client";
import { books, chapters, documentChunks, documentPages, type Chapter, type DocumentPage } from "@/lib/db/schema";
import type { ChunkDraft, StructuredDocument, StructuredPage } from "@/lib/documents/types";
import type { ChunkMetadata, PageBlock } from "@/types/domain";

const INSERT_BATCH = 200;

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface ChunkToEmbed {
  id: string;
  content: string;
  sectionTitle: string | null;
  metadata: ChunkMetadata;
}

export interface ChunkWithContext {
  id: string;
  bookId: string;
  chapterId: string | null;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageStart: number;
  pageEnd: number;
  sectionTitle: string | null;
  metadata: ChunkMetadata;
  chapterTitle: string | null;
  chapterLabel: string | null;
  chapterNumber: number | null;
}

/**
 * Data access for a book's derived content: chapters, cleaned pages and chunks.
 * Callers must have verified book ownership (these are keyed by bookId).
 */
export class DocumentRepository {
  constructor(private readonly db: Database) {}

  /* ------------------------------- Ingestion ------------------------------ */

  /** Atomically replace a book's chapters and pages (and drop stale chunks). */
  async replaceStructure(bookId: string, doc: StructuredDocument): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.bookId, bookId));
      await tx.delete(documentPages).where(eq(documentPages.bookId, bookId));
      await tx.delete(chapters).where(eq(chapters.bookId, bookId));

      const chapterIds = new Map<number, string>();
      if (doc.chapters.length > 0) {
        const inserted = await tx
          .insert(chapters)
          .values(doc.chapters.map((chapter) => ({ bookId, ...chapter })))
          .returning({ id: chapters.id, chapterNumber: chapters.chapterNumber });
        for (const row of inserted) chapterIds.set(row.chapterNumber, row.id);
      }

      for (const batch of batches(doc.pages, INSERT_BATCH)) {
        await tx.insert(documentPages).values(
          batch.map((page) => ({
            bookId,
            chapterId: page.chapterNumber ? (chapterIds.get(page.chapterNumber) ?? null) : null,
            pageNumber: page.pageNumber,
            pageLabel: page.pageLabel,
            content: page.content,
            blocks: page.blocks,
            wordCount: page.wordCount,
          })),
        );
      }
    });
  }

  /** Remove everything derived from the PDF (used before reprocessing). */
  async clearDerived(bookId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.bookId, bookId));
      await tx.delete(documentPages).where(eq(documentPages.bookId, bookId));
      await tx.delete(chapters).where(eq(chapters.bookId, bookId));
    });
  }

  async countPages(bookId: string): Promise<number> {
    const [{ value }] = await this.db.select({ value: count() }).from(documentPages).where(eq(documentPages.bookId, bookId));
    return value;
  }

  /** Pages in reading order, shaped for the chunker. */
  async loadStructuredPages(bookId: string): Promise<StructuredPage[]> {
    const rows = await this.db
      .select({
        pageNumber: documentPages.pageNumber,
        pageLabel: documentPages.pageLabel,
        blocks: documentPages.blocks,
        content: documentPages.content,
        wordCount: documentPages.wordCount,
        chapterNumber: chapters.chapterNumber,
      })
      .from(documentPages)
      .leftJoin(chapters, eq(chapters.id, documentPages.chapterId))
      .where(eq(documentPages.bookId, bookId))
      .orderBy(asc(documentPages.pageNumber));
    return rows.map((row) => ({ ...row, chapterNumber: row.chapterNumber ?? null }));
  }

  async insertChunks(bookId: string, drafts: ChunkDraft[]): Promise<void> {
    const chapterRows = await this.listChapters(bookId);
    const chapterIds = new Map(chapterRows.map((chapter) => [chapter.chapterNumber, chapter.id]));
    const pageRows = await this.db
      .select({ id: documentPages.id, pageNumber: documentPages.pageNumber })
      .from(documentPages)
      .where(eq(documentPages.bookId, bookId));
    const pageIds = new Map(pageRows.map((page) => [page.pageNumber, page.id]));

    await this.db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.bookId, bookId));
      for (const batch of batches(drafts, INSERT_BATCH)) {
        await tx.insert(documentChunks).values(
          batch.map((draft) => ({
            bookId,
            chapterId: draft.chapterNumber ? (chapterIds.get(draft.chapterNumber) ?? null) : null,
            pageId: pageIds.get(draft.pageStart) ?? null,
            chunkIndex: draft.chunkIndex,
            content: draft.content,
            tokenCount: draft.tokenCount,
            pageStart: draft.pageStart,
            pageEnd: draft.pageEnd,
            sectionTitle: draft.sectionTitle,
            metadata: draft.metadata,
          })),
        );
      }
    });
  }

  async countChunks(bookId: string): Promise<{ total: number; embedded: number }> {
    const [row] = await this.db
      .select({
        total: count(),
        embedded: sql<number>`count(${documentChunks.embedding})::int`,
      })
      .from(documentChunks)
      .where(eq(documentChunks.bookId, bookId));
    return { total: row.total, embedded: Number(row.embedded) };
  }

  async nextChunksToEmbed(bookId: string, limit: number): Promise<ChunkToEmbed[]> {
    return this.db
      .select({
        id: documentChunks.id,
        content: documentChunks.content,
        sectionTitle: documentChunks.sectionTitle,
        metadata: documentChunks.metadata,
      })
      .from(documentChunks)
      .where(and(eq(documentChunks.bookId, bookId), isNull(documentChunks.embedding)))
      .orderBy(asc(documentChunks.chunkIndex))
      .limit(limit);
  }

  async setEmbeddings(rows: { id: string; embedding: number[] }[]): Promise<void> {
    if (rows.length === 0) return;
    const values = sql.join(
      rows.map((row) => sql`(${row.id}::uuid, ${toVectorLiteral(row.embedding)}::vector)`),
      sql`, `,
    );
    await this.db.execute(sql`
      update ${documentChunks} as c
      set embedding = v.embedding
      from (values ${values}) as v(id, embedding)
      where c.id = v.id
    `);
  }

  async analyzeChunks(): Promise<void> {
    // Refresh planner statistics so the vector / full-text indexes are used well.
    await this.db.execute(sql`analyze ${documentChunks}`);
  }

  /* --------------------------------- Reads -------------------------------- */

  async listChapters(bookId: string): Promise<Chapter[]> {
    return this.db.select().from(chapters).where(eq(chapters.bookId, bookId)).orderBy(asc(chapters.chapterNumber));
  }

  async getPage(bookId: string, pageNumber: number): Promise<(DocumentPage & { chapterTitle: string | null; chapterLabel: string | null }) | null> {
    const [row] = await this.db
      .select({ page: documentPages, chapterTitle: chapters.title, chapterLabel: chapters.label })
      .from(documentPages)
      .leftJoin(chapters, eq(chapters.id, documentPages.chapterId))
      .where(and(eq(documentPages.bookId, bookId), eq(documentPages.pageNumber, pageNumber)))
      .limit(1);
    return row ? { ...row.page, chapterTitle: row.chapterTitle, chapterLabel: row.chapterLabel } : null;
  }

  /** Resolve a printed page label ("184") to a physical page number. */
  async resolvePageLabel(bookId: string, label: string): Promise<number | null> {
    const [row] = await this.db
      .select({ pageNumber: documentPages.pageNumber })
      .from(documentPages)
      .where(and(eq(documentPages.bookId, bookId), eq(documentPages.pageLabel, label)))
      .limit(1);
    return row?.pageNumber ?? null;
  }

  /** Printed labels for the given physical pages (only pages that have one). */
  async pageLabels(bookId: string, pageNumbers: number[]): Promise<Map<number, string>> {
    if (pageNumbers.length === 0) return new Map();
    const rows = await this.db
      .select({ pageNumber: documentPages.pageNumber, pageLabel: documentPages.pageLabel })
      .from(documentPages)
      .where(and(eq(documentPages.bookId, bookId), inArray(documentPages.pageNumber, [...new Set(pageNumbers)])));
    return new Map(rows.flatMap((row) => (row.pageLabel ? [[row.pageNumber, row.pageLabel] as const] : [])));
  }

  async pageBlocks(bookId: string, pageNumber: number): Promise<PageBlock[] | null> {
    const [row] = await this.db
      .select({ blocks: documentPages.blocks })
      .from(documentPages)
      .where(and(eq(documentPages.bookId, bookId), eq(documentPages.pageNumber, pageNumber)))
      .limit(1);
    return row?.blocks ?? null;
  }

  async getChunkWithContext(bookId: string, chunkId: string): Promise<ChunkWithContext | null> {
    const [row] = await this.db
      .select({
        id: documentChunks.id,
        bookId: documentChunks.bookId,
        chapterId: documentChunks.chapterId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        tokenCount: documentChunks.tokenCount,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
        sectionTitle: documentChunks.sectionTitle,
        metadata: documentChunks.metadata,
        chapterTitle: chapters.title,
        chapterLabel: chapters.label,
        chapterNumber: chapters.chapterNumber,
      })
      .from(documentChunks)
      .leftJoin(chapters, eq(chapters.id, documentChunks.chapterId))
      .where(and(eq(documentChunks.id, chunkId), eq(documentChunks.bookId, bookId)))
      .limit(1);
    return row ?? null;
  }

  /** Chunks overlapping a page range, in reading order. */
  async chunksInPageRange(bookId: string, from: number, to: number, limit = 6): Promise<ChunkWithContext[]> {
    return this.db
      .select({
        id: documentChunks.id,
        bookId: documentChunks.bookId,
        chapterId: documentChunks.chapterId,
        chunkIndex: documentChunks.chunkIndex,
        content: documentChunks.content,
        tokenCount: documentChunks.tokenCount,
        pageStart: documentChunks.pageStart,
        pageEnd: documentChunks.pageEnd,
        sectionTitle: documentChunks.sectionTitle,
        metadata: documentChunks.metadata,
        chapterTitle: chapters.title,
        chapterLabel: chapters.label,
        chapterNumber: chapters.chapterNumber,
      })
      .from(documentChunks)
      .leftJoin(chapters, eq(chapters.id, documentChunks.chapterId))
      .where(and(eq(documentChunks.bookId, bookId), lte(documentChunks.pageStart, to), gte(documentChunks.pageEnd, from)))
      .orderBy(asc(documentChunks.chunkIndex))
      .limit(limit);
  }

  async bookExists(bookId: string): Promise<boolean> {
    const [row] = await this.db.select({ id: books.id }).from(books).where(eq(books.id, bookId)).limit(1);
    return !!row;
  }
}
