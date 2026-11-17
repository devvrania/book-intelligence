import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { BookWorkspace } from "@/components/books/book-workspace";
import { isAppError } from "@/lib/errors";
import { getServices } from "@/server/container";
import { parseVisitorId, VISITOR_COOKIE } from "@/server/http/visitor";
import type { BookDetail } from "@/types/api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadBook(id: string): Promise<BookDetail> {
  if (!UUID_RE.test(id)) notFound();
  try {
    return await getServices().books.get(id);
  } catch (error) {
    if (isAppError(error) && error.code === "not_found") notFound();
    throw error;
  }
}

export async function generateMetadata(props: PageProps<"/books/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  try {
    const book = await loadBook(id);
    return { title: book.title };
  } catch {
    return { title: "Book" };
  }
}

export default async function BookPage(props: PageProps<"/books/[id]">) {
  const { id } = await props.params;
  const book = await loadBook(id);
  const services = getServices();
  await services.books.markOpened(id);

  // Chats are private: reopen this visitor's latest chat about the book, if they've asked anything yet
  const visitorId = parseVisitorId((await cookies()).get(VISITOR_COOKIE)?.value);
  const [latest] = book.status === "READY" ? await services.conversations.list(id, visitorId) : [];
  const conversationId = latest?.id ?? null;
  return (
    <BookWorkspace book={book} initialConversationId={conversationId} currentEmbeddingModel={services.embeddings.model} />
  );
}
