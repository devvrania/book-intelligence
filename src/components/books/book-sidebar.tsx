"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BookDetail, ChapterSummary } from "@/types/api";

import { BookActionsMenu } from "./book-actions-menu";
import { BookCover } from "./book-cover";

export function chapterDisplay(chapter: ChapterSummary) {
  const hasDistinctTitle = chapter.label && chapter.title !== chapter.label;
  return { label: chapter.label ?? `Chapter ${chapter.chapterNumber}`, title: hasDistinctTitle || !chapter.label ? chapter.title : null };
}

/** The book's details: cover, a way into the reader, its description and its chapters. */
export function BookSidebar({ book, className }: { book: BookDetail; className?: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("flex flex-col gap-6 px-6 py-7", className)}>
      <div className="flex flex-col items-center text-center">
        <BookCover title={book.title} author={book.author} coverUrl={book.coverUrl} seed={book.id} className="w-36" />
        <h1 className="mt-5 font-display text-2xl leading-tight font-semibold tracking-tight text-foreground">{book.title}</h1>
        {book.author && <p className="mt-1.5 text-sm text-muted-foreground">{book.author}</p>}
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button asChild className="h-9 flex-1 rounded-full">
          <Link href={`/books/${book.id}/read`}>
            <BookOpen />
            Read
          </Link>
        </Button>
        <BookActionsMenu book={book} />
      </div>

      {book.description && (
        <div className="text-sm leading-relaxed text-muted-foreground">
          <p className={cn(!expanded && "line-clamp-4")}>{book.description}</p>
          {book.description.length > 220 && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-medium text-primary hover:underline">
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {book.chapters.length > 0 && (
        <nav aria-label="Chapters">
          <h2 className="mb-2 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">Chapters</h2>
          {/* grid-cols-1 = minmax(0, 1fr): rows can shrink, so long titles truncate instead of widening the list */}
          <ol className="grid grid-cols-1 gap-0.5">
            {book.chapters.map((chapter) => {
              const display = chapterDisplay(chapter);
              return (
                <li key={chapter.id}>
                  <Link
                    href={`/books/${book.id}/read?page=${chapter.startPage}`}
                    className="flex items-baseline gap-2 rounded-xl px-2.5 py-2 text-sm transition hover:bg-card"
                  >
                    {/* a number only when the book labels the chapter ("Chapter IV"); otherwise the title carries its own */}
                    {chapter.label && (
                      <span className="w-9 shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                        {chapter.label.replace(/^Chapter\s+/i, "")}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-foreground/90">{display.title ?? display.label}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/70 tabular-nums">p. {chapter.startPage}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      )}
    </div>
  );
}
