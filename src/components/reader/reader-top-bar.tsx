"use client";

import { ChevronLeft, Sparkles, TableOfContents } from "lucide-react";
import Link from "next/link";

import { BookCover } from "@/components/books/book-cover";
import { Button } from "@/components/ui/button";
import type { BookDetail } from "@/types/api";

interface ReaderTopBarProps {
  book: Pick<BookDetail, "id" | "title" | "author" | "coverUrl">;
  /** "Chapter II · Waging War", or null outside chapters. */
  chapterText: string | null;
  /** Reading progress, 0–1. */
  progress: number;
  onOpenContents: () => void;
}

/** Sticky reader bar: back to the book, the current chapter, contents (small screens) and a way to ask. */
export function ReaderTopBar({ book, chapterText, progress, onOpenContents }: ReaderTopBarProps) {
  return (
    <div className="sticky top-14 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Link
          href={`/books/${book.id}`}
          aria-label={`Back to ${book.title}`}
          className="group flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pr-2 pl-1 transition-colors outline-none hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 md:max-w-[22rem] md:flex-none"
        >
          <ChevronLeft
            aria-hidden
            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-x-0.5 group-hover:text-foreground"
          />
          <BookCover title={book.title} author={book.author} coverUrl={book.coverUrl} seed={book.id} size="xs" className="w-7" />
          <span className="min-w-0">
            <span className="block truncate font-display text-sm leading-tight font-semibold text-foreground">
              {book.title}
            </span>
            {book.author && <span className="block truncate text-xs text-muted-foreground">{book.author}</span>}
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          {chapterText && (
            <p className="truncate rounded-full bg-muted/70 px-3 py-1 text-xs text-muted-foreground">
              <span className="sr-only">Current chapter: </span>
              {chapterText}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenContents}>
            <TableOfContents />
            <span className="sr-only">Contents</span>
          </Button>
          <Button asChild className="rounded-full px-3 shadow-soft">
            <Link href={`/books/${book.id}`}>
              <Sparkles />
              Ask AI
            </Link>
          </Button>
        </div>
      </div>

      <div aria-hidden className="absolute inset-x-0 -bottom-px h-[2px]">
        <div
          className="h-full rounded-r-full bg-gradient-to-r from-primary/35 to-primary/70 transition-[width] duration-500 ease-out"
          style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }}
        />
      </div>
    </div>
  );
}
