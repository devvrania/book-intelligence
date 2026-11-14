import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";

import type { Database } from "@/lib/db/client";
import { books, type Book, type NewBook } from "@/lib/db/schema";
import type { BookStatus, ProcessingProgress, ProcessingStage } from "@/types/domain";

export type BookSort = "recent" | "opened" | "title";

export interface ListBooksOptions {
  search?: string;
  status?: BookStatus;
  sort?: BookSort;
  limit?: number;
  offset?: number;
}

/** Columns needed by library cards (no heavy JSON). */
const listColumns = {
  id: books.id,
  title: books.title,
  author: books.author,
  coverKey: books.coverKey,
  pageCount: books.pageCount,
  chunkCount: books.chunkCount,
  status: books.status,
  processingStage: books.processingStage,
  processingProgress: books.processingProgress,
  processingError: books.processingError,
  lastOpenedAt: books.lastOpenedAt,
  createdAt: books.createdAt,
  updatedAt: books.updatedAt,
};

export type BookListRow = { [K in keyof typeof listColumns]: Book[K] };

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Data access for books. There are no owners: every book belongs to the shared library. */
export class BookRepository {
  constructor(private readonly db: Database) {}

  async create(values: NewBook): Promise<Book> {
    const [book] = await this.db.insert(books).values(values).returning();
    return book;
  }

  async findById(bookId: string): Promise<Book | null> {
    const [book] = await this.db.select().from(books).where(eq(books.id, bookId)).limit(1);
    return book ?? null;
  }

  async list(options: ListBooksOptions = {}): Promise<{ items: BookListRow[]; total: number }> {
    const conditions: SQL[] = [];
    if (options.status) conditions.push(eq(books.status, options.status));
    const search = options.search?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push(or(ilike(books.title, pattern), ilike(books.author, pattern))!);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const orderBy =
      options.sort === "title"
        ? [asc(sql`lower(${books.title})`)]
        : options.sort === "opened"
          ? [sql`${books.lastOpenedAt} desc nulls last`, desc(books.updatedAt)]
          : [desc(books.createdAt)];

    const [items, [{ total }]] = await Promise.all([
      this.db
        .select(listColumns)
        .from(books)
        .where(where)
        .orderBy(...orderBy)
        .limit(options.limit ?? 24)
        .offset(options.offset ?? 0),
      this.db.select({ total: count() }).from(books).where(where),
    ]);
    return { items, total };
  }

  async update(bookId: string, values: Partial<NewBook>): Promise<Book | null> {
    const [book] = await this.db.update(books).set(values).where(eq(books.id, bookId)).returning();
    return book ?? null;
  }

  async setStage(bookId: string, stage: ProcessingStage, progress: ProcessingProgress | null = null) {
    await this.db
      .update(books)
      .set({ status: "PROCESSING", processingStage: stage, processingProgress: progress, processingError: null })
      .where(eq(books.id, bookId));
  }

  async markOpened(bookId: string) {
    // Don't bump updated_at: opening a book isn't an edit.
    await this.db.execute(sql`update ${books} set last_opened_at = now() where ${books.id} = ${bookId}`);
  }

  async delete(bookId: string): Promise<Book | null> {
    const [book] = await this.db.delete(books).where(eq(books.id, bookId)).returning();
    return book ?? null;
  }
}
