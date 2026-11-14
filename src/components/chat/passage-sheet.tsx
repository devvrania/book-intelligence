"use client";

import { BookOpen } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { usePassage } from "@/features/books/api";
import type { SourceDTO } from "@/types/api";

import { chapterSubtitleOf, citationNumber, sourceLocation } from "./source-utils";

/**
 * The full passage behind a citation: exactly the text that was retrieved and
 * shown to the model (fetched by chunk id), with a link into the reader.
 */
export function PassageSheet({
  bookId,
  source,
  onOpenChange,
}: {
  bookId: string;
  source: SourceDTO | null;
  onOpenChange: (open: boolean) => void;
}) {
  const passage = usePassage(bookId, source?.chunkId ?? null);
  const subtitle = source ? chapterSubtitleOf(source) : null;

  const paragraphs = passage.data
    ? passage.data.content
        .slice(passage.data.overlapChars)
        .trim()
        .split(/\n{2,}/)
    : null;

  const readerHref = source
    ? `/books/${bookId}/read?page=${source.pageStart}${source.chunkId ? `&passage=${source.chunkId}` : ""}`
    : "#";

  return (
    <Sheet open={!!source} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 bg-background p-0 sm:max-w-lg">
        {source && (
          <>
            <SheetHeader className="border-b border-border/70 px-6 pt-6 pb-4">
              <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.16em] text-primary uppercase">
                <span className="flex size-5 items-center justify-center rounded-full bg-rose-soft text-[10px] text-accent-foreground">
                  {citationNumber(source.label)}
                </span>
                Source
              </p>
              <SheetTitle className="font-display text-xl">{sourceLocation(source)}</SheetTitle>
              <SheetDescription>{subtitle ?? "Retrieved passage from the book"}</SheetDescription>
            </SheetHeader>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              {!source.chunkId ? (
                <>
                  <p className="mb-3 text-xs text-muted-foreground">
                    This book has been re-processed since this answer was written. Here is the excerpt that was cited:
                  </p>
                  <blockquote className="prose-reading border-l-2 border-rose-soft pl-4 italic">{source.excerpt}</blockquote>
                </>
              ) : passage.isLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 6 }, (_, i) => (
                    <Skeleton key={i} className="h-4" style={{ width: `${92 - (i % 3) * 9}%` }} />
                  ))}
                </div>
              ) : passage.error ? (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">We couldn&apos;t load the full passage. The cited excerpt:</p>
                  <blockquote className="prose-reading border-l-2 border-rose-soft pl-4 italic">{source.excerpt}</blockquote>
                </>
              ) : (
                <article className="prose-reading text-[1.05rem]">
                  {paragraphs?.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </article>
              )}
            </div>

            <div className="border-t border-border/70 bg-card/60 px-6 py-4">
              <Button asChild className="h-10 w-full rounded-xl">
                <Link href={readerHref}>
                  <BookOpen />
                  Open in reader
                </Link>
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
