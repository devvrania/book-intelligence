"use client";

import { ArrowLeft, BookOpen, ListTree } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatPanel } from "@/components/chat/chat-panel";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { isProcessing, useBook } from "@/features/books/api";
import { embeddingModelsMatch } from "@/lib/embeddings/model-id";
import type { BookDetail } from "@/types/api";

import { BookCover } from "./book-cover";
import { BookProcessingView } from "./book-processing-view";
import { BookSidebar } from "./book-sidebar";
import { ReindexBanner } from "./reindex-banner";

/**
 * The book page: details + chapters on the left, the book's conversation as the main surface.
 * While the book is still being prepared, a live processing view takes its place.
 */
export function BookWorkspace({
  book: initial,
  initialConversationId,
  currentEmbeddingModel,
}: {
  book: BookDetail;
  /** The book's shared conversation, if anyone has asked it something yet. */
  initialConversationId: string | null;
  /** The embedding model configured on the server right now. */
  currentEmbeddingModel: string;
}) {
  const { data: book = initial } = useBook(initial.id, initial);
  const [chaptersOpen, setChaptersOpen] = useState(false);
  const wasProcessing = useRef(isProcessing(initial.status));

  useEffect(() => {
    if (wasProcessing.current && book.status === "READY") toast.success(`“${book.title}” is ready — ask it anything.`);
    wasProcessing.current = isProcessing(book.status);
  }, [book.status, book.title]);

  if (book.status !== "READY") return <BookProcessingView book={book} />;

  return (
    <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[330px_minmax(0,1fr)]">
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] overflow-y-auto border-r border-border/60 bg-sidebar/60 lg:block">
        <BookSidebar book={book} />
      </aside>

      <section className="flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col">
        {/* Compact book bar for small screens */}
        <div className="flex items-center gap-3 border-b border-border/60 px-4 py-2.5 lg:hidden">
          <Link href="/" className="rounded-full p-1.5 text-muted-foreground hover:bg-muted" aria-label="Back to library">
            <ArrowLeft className="size-4" />
          </Link>
          <BookCover title={book.title} coverUrl={book.coverUrl} seed={book.id} size="xs" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-sm font-semibold">{book.title}</p>
            {book.author && <p className="truncate text-xs text-muted-foreground">{book.author}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setChaptersOpen(true)} aria-label="Book details and chapters">
            <ListTree />
          </Button>
          <Button asChild size="icon" variant="ghost" aria-label="Read">
            <Link href={`/books/${book.id}/read`}>
              <BookOpen />
            </Link>
          </Button>
        </div>

        {!embeddingModelsMatch(book.embeddingModel, currentEmbeddingModel) && book.embeddingModel && (
          <ReindexBanner bookId={book.id} indexedWith={book.embeddingModel} current={currentEmbeddingModel} />
        )}
        <ChatPanel book={book} initialConversationId={initialConversationId} className="flex-1" />
      </section>

      <Sheet open={chaptersOpen} onOpenChange={setChaptersOpen}>
        <SheetContent side="left" className="w-[88vw] overflow-x-hidden overflow-y-auto bg-background p-0 sm:max-w-sm">
          <SheetTitle className="sr-only">{book.title}</SheetTitle>
          <BookSidebar book={book} />
        </SheetContent>
      </Sheet>

    </div>
  );
}
