"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";
import type { ChapterSummary } from "@/types/api";

interface ChapterListProps {
  chapters: ChapterSummary[];
  currentChapterId: string | null;
  onSelect: (chapter: ChapterSummary) => void;
  className?: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The book's table of contents; the current chapter is highlighted and kept in view. */
export function ChapterList({ chapters, currentChapterId, onSelect, className }: ChapterListProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = Math.max(0, top - list.clientHeight / 2 + active.offsetHeight / 2);
    }
  }, [currentChapterId]);

  if (chapters.length === 0) {
    return (
      <p className={cn("px-4 py-3 text-sm leading-relaxed text-muted-foreground", className)}>
        No chapters were detected in this book — use the page controls to move through it.
      </p>
    );
  }

  return (
    <ol ref={listRef} className={cn("relative space-y-0.5 overflow-y-auto overscroll-contain", className)}>
      {chapters.map((chapter) => {
        const current = chapter.id === currentChapterId;
        const showLabel = chapter.label && !same(chapter.label, chapter.title);
        return (
          <li key={chapter.id}>
            <button
              type="button"
              aria-current={current ? "location" : undefined}
              onClick={() => onSelect(chapter)}
              className={cn(
                "group relative flex w-full items-start gap-3 rounded-xl py-2 pr-3 pl-4 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                current ? "bg-accent" : "hover:bg-muted/80",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-2.5 bottom-2.5 left-1.5 w-[3px] rounded-full transition-colors",
                  current ? "bg-primary" : "bg-transparent group-hover:bg-border",
                )}
              />
              <span className="min-w-0 flex-1">
                {showLabel && (
                  <span
                    className={cn(
                      "block text-[0.66rem] font-semibold tracking-[0.14em] uppercase",
                      current ? "text-primary" : "text-muted-foreground/80",
                    )}
                  >
                    {chapter.label}
                  </span>
                )}
                <span
                  className={cn(
                    "block text-[0.85rem] leading-snug",
                    current ? "font-medium text-accent-foreground" : "text-foreground/85",
                  )}
                >
                  {chapter.title}
                </span>
              </span>
              <span className="mt-px shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">
                <span className="sr-only">, page </span>
                {chapter.startPage}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
