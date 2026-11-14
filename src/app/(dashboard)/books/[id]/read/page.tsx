import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { ReaderView } from "@/components/reader/reader-view";
import { logger } from "@/lib/logger";
import { getServices } from "@/server/container";
import type { BookDetail } from "@/types/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isNotFound = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "not_found";

/** The book, or null when it doesn't exist. Shared by the page and its metadata. */
const loadBook = cache(async (bookId: string): Promise<BookDetail | null> => {
  try {
    return await getServices().books.get(bookId);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
});

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata(props: PageProps<"/books/[id]/read">): Promise<Metadata> {
  const { id } = await props.params;
  if (!UUID.test(id)) return { title: "Book not found" };
  const book = await loadBook(id);
  return { title: book ? `Reading · ${book.title}` : "Book not found" };
}

export default async function ReadPage(props: PageProps<"/books/[id]/read">) {
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();

  const book = await loadBook(id);
  if (!book) notFound();
  if (book.status !== "READY") redirect(`/books/${id}`);

  const sp = await props.searchParams;
  const pageCount = Math.max(1, book.pageCount ?? book.chapters.at(-1)?.endPage ?? 1);
  const rawPage = first(sp.page)?.trim();
  const requested = rawPage && /^\d{1,7}$/.test(rawPage) ? Number.parseInt(rawPage, 10) : null;
  const initialPage = Math.min(Math.max(1, requested ?? book.chapters[0]?.startPage ?? 1), pageCount);

  const rawPassage = first(sp.passage)?.trim();
  const initialPassageId = rawPassage && UUID.test(rawPassage) ? rawPassage : null;

  const services = getServices();
  const [initialPageData] = await Promise.all([
    // Server-render the first page; the client falls back to fetching it if this fails.
    services.books.getPage(id, initialPage).catch(() => null),
    services.books
      .markOpened(id)
      .catch((error: unknown) => logger.warn("reader.mark_opened_failed", { bookId: id, error })),
  ]);

  return (
    <ReaderView
      book={book}
      initialPage={initialPage}
      initialPassageId={initialPassageId}
      initialPageData={initialPageData}
    />
  );
}
