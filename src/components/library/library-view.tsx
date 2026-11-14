"use client";

import { AnimatePresence, MotionConfig, motion } from "framer-motion";
import { Plus, RefreshCw } from "lucide-react";
import { useCallback, useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { isProcessing, useLibrary } from "@/features/books/api";
import { cn } from "@/lib/utils";
import type { BookListResponse } from "@/types/api";

import { BookCard } from "./book-card";
import { EmptyLibrary } from "./empty-library";
import { pluralize } from "./format";
import { useNow, usePageFileDrop } from "./hooks";
import { BOOK_GRID, LibraryBackdrop, PAGE_CONTAINER } from "./library-skeleton";
import { AddBookTile, DropOverlay } from "./upload-dropzone";
import { useBookUploads } from "./use-book-uploads";
import { useReadyNotifications } from "./use-ready-notifications";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export interface LibraryViewProps {
  initialData: BookListResponse;
  /** Server-side upload limit, used to reject oversized files before sending them. */
  maxUploadMb?: number;
}

/** The home page: a short intro, then every book in one grid (newest first) with a tile to add more. */
export function LibraryView({ initialData, maxUploadMb }: LibraryViewProps) {
  const library = useLibrary({ sort: "recent" }, initialData);
  const all = library.data ?? initialData;
  useReadyNotifications(library.data?.items);

  const now = useNow();
  const { uploads, enqueue, busy } = useBookUploads({
    maxUploadBytes: maxUploadMb ? Math.round(maxUploadMb * 1024 * 1024) : undefined,
  });
  const dragActive = usePageFileDrop(enqueue);
  const fileInput = useRef<HTMLInputElement>(null);
  const browse = useCallback(() => fileInput.current?.click(), []);

  const isEmpty = all.total === 0;
  const preparing = all.items.filter((book) => isProcessing(book.status)).length;
  // While we're sending a file its record is still UPLOADING server-side; the
  // upload tile already represents it, so don't show it twice.
  const items = all.items.filter((book) => !(busy && book.status === "UPLOADING"));

  // The server renders the first page, so there's always data to show; only a failed refresh changes that.
  let content: ReactNode;
  if (!library.data && library.isError) {
    content = <LoadError onRetry={() => void library.refetch()} />;
  } else {
    content = (
      <ul className={BOOK_GRID}>
        <li>
          <AddBookTile uploads={uploads} onBrowse={browse} dragActive={dragActive} maxUploadMb={maxUploadMb} />
        </li>
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((book, index) => {
            const delay = Math.min(index, 12) * 0.035;
            return (
              <motion.li
                key={book.id}
                layout="position"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
                transition={{
                  opacity: { duration: 0.4, delay },
                  y: { duration: 0.5, delay, ease: EASE_OUT },
                  layout: { type: "spring", stiffness: 380, damping: 34 },
                }}
              >
                <BookCard book={book} now={now} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative isolate flex-1">
        <LibraryBackdrop />
        <main className={cn(PAGE_CONTAINER, "pt-10 pb-20 sm:pt-14")}>
          <LibraryHeader total={all.total} preparing={preparing} onAdd={isEmpty ? undefined : browse} />
          {isEmpty ? (
            <EmptyLibrary uploads={uploads} onBrowse={browse} dragActive={dragActive} maxUploadMb={maxUploadMb} />
          ) : (
            <div className="mt-12">{content}</div>
          )}
        </main>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        tabIndex={-1}
        aria-hidden
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) enqueue(files);
        }}
      />
      <DropOverlay active={dragActive && !isEmpty} />
    </MotionConfig>
  );
}

function LibraryHeader({ total, preparing, onAdd }: { total: number; preparing: number; onAdd?: () => void }) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-4xl leading-[1.08] font-semibold tracking-tight text-foreground sm:text-5xl">
          Understand your books. <span className="text-gradient-rose">Don’t just read them.</span>
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Open a book or add a PDF, ask anything, and every answer cites the exact chapter and page.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          {total === 0 ? "No books yet" : pluralize(total, "book")}
          {preparing > 0 && ` · ${preparing} being prepared`}
        </p>
      </div>

      {onAdd && (
        <Button type="button" onClick={onAdd} className="h-10 self-start rounded-full px-5 shadow-lifted sm:self-auto">
          <Plus aria-hidden />
          Add a book
        </Button>
      )}
    </header>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-[1.75rem] border border-dashed border-border bg-card/60 px-6 py-14 text-center sm:py-20">
      <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">We couldn’t load the books</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button type="button" variant="outline" onClick={onRetry} className="mt-6 h-9 rounded-full bg-card px-4">
        <RefreshCw aria-hidden />
        Try again
      </Button>
    </div>
  );
}
