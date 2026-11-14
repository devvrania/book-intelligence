"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { PageDTO } from "@/types/api";

import { chapterLine, layoutBlocks, type LayoutItem } from "./reader-text";

export interface PageHighlights {
  /** Whether a paragraph belongs to the cited passage being highlighted, or null. */
  isPassageText: ((text: string) => boolean) | null;
}

interface PageContentProps {
  page: PageDTO;
  bookTitle: string;
  highlights: PageHighlights;
  /** True while a highlight source (the passage) is still loading. */
  highlightsPending?: boolean;
  /** Bumped by the reader on every navigation, to re-run `onRendered` for the same page. */
  scrollRequest: number;
  /** Called after the page (and its highlights) are in the DOM, e.g. to scroll to the first highlight. */
  onRendered: (root: HTMLElement, pageNumber: number) => void;
}

/** One page of the book, typeset from its structured blocks. Text is only ever rendered as text nodes. */
export function PageContent({
  page,
  bookTitle,
  highlights,
  highlightsPending = false,
  scrollRequest,
  onRendered,
}: PageContentProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const items = useMemo(() => layoutBlocks(page.blocks), [page.blocks]);
  const highlightKey = highlights.isPassageText ? "passage" : "";

  useEffect(() => {
    if (highlightsPending || !rootRef.current) return;
    onRendered(rootRef.current, page.pageNumber);
  }, [onRendered, page.pageNumber, highlightsPending, scrollRequest, highlightKey]);

  const opensChapter = items[0]?.kind === "chapter";
  const runningHead = chapterLine(page.chapter?.label ?? null, page.chapter?.title ?? null);
  const folio = page.pageLabel ?? String(page.pageNumber);

  return (
    <div ref={rootRef} className="mx-auto flex w-full max-w-[65ch] flex-1 flex-col">
      {!opensChapter && (
        <div
          aria-hidden
          className="mb-9 flex items-baseline justify-between gap-6 border-b border-border/60 pb-3 text-[0.66rem] font-medium tracking-[0.2em] text-muted-foreground/90 uppercase sm:mb-11"
        >
          <span className="hidden truncate sm:block">{bookTitle}</span>
          {runningHead && <span className="truncate sm:text-right">{runningHead}</span>}
        </div>
      )}

      {items.length === 0 ? (
        <p className="py-16 text-center font-reading text-base text-muted-foreground italic">
          This page has no text — it may be blank or contain only images.
        </p>
      ) : (
        <div className="prose-reading text-[1.0625rem] sm:text-[1.125rem] [&_p+p]:mt-[0.8em]">
          {renderItems(items, highlights)}
        </div>
      )}

      <p
        aria-hidden
        className="mt-auto flex items-center justify-center gap-3 pt-12 font-reading text-sm text-muted-foreground tabular-nums sm:pt-14"
      >
        <span className="h-px w-8 bg-border" />
        {folio}
        <span className="h-px w-8 bg-border" />
      </p>
    </div>
  );
}

function renderItems(items: LayoutItem[], { isPassageText }: PageHighlights): ReactNode[] {
  const nodes: ReactNode[] = [];
  let passageRun: ReactNode[] = [];
  let passageKey = "";

  const flushPassage = () => {
    if (passageRun.length === 0) return;
    nodes.push(
      <div
        key={`passage-${passageKey}`}
        data-reader-hit=""
        className="relative -mx-4 my-[0.9em] scroll-mt-40 rounded-2xl bg-lavender-soft/70 px-4 py-3 ring-1 ring-lavender/10 first:mt-0 last:mb-0 sm:-mx-6 sm:px-6 sm:py-4"
      >
        <span aria-hidden className="absolute top-4 bottom-4 left-0 w-[3px] rounded-full bg-lavender/55" />
        <span className="sr-only">Cited passage: </span>
        {passageRun}
      </div>,
    );
    passageRun = [];
  };

  for (const item of items) {
    if (item.kind === "paragraph" && isPassageText?.(item.text)) {
      if (passageRun.length === 0) passageKey = item.key;
      passageRun.push(<Paragraph key={item.key} item={item} />);
      continue;
    }
    flushPassage();

    switch (item.kind) {
      case "chapter":
        nodes.push(
          <header key={item.key} className="mb-10 pt-2 text-center not-first:mt-14 sm:mb-12 sm:pt-6">
            {item.eyebrow && (
              <p className="font-sans text-[0.7rem] font-semibold tracking-[0.32em] text-primary uppercase">
                {item.eyebrow}
              </p>
            )}
            {item.titles.map((title, index) => (
              <h2
                key={index}
                className={cn(
                  "font-display text-[1.9rem] leading-[1.15] font-semibold tracking-tight text-balance text-foreground sm:text-[2.5rem]",
                  (item.eyebrow || index > 0) && "mt-3",
                )}
              >
                {title}
              </h2>
            ))}
            <Ornament className="mt-6" />
          </header>,
        );
        break;
      case "section":
        nodes.push(
          <h3
            key={item.key}
            className="mt-10 mb-5 text-center font-display text-[1.3rem] leading-snug font-semibold text-balance text-foreground/90 first:mt-0"
          >
            {item.text}
          </h3>,
        );
        break;
      case "break":
        nodes.push(<Ornament key={item.key} className="my-9" separator />);
        break;
      case "paragraph":
        nodes.push(<Paragraph key={item.key} item={item} />);
        break;
    }
  }
  flushPassage();
  return nodes;
}

function Paragraph({ item }: { item: Extract<LayoutItem, { kind: "paragraph" }> }) {
  return (
    <p
      className={cn(
        item.indent && "indent-[1.6em]",
        item.dropCap &&
          "first-letter:float-left first-letter:mt-[0.06em] first-letter:mr-1.5 first-letter:font-display first-letter:text-[3.35em] first-letter:leading-[0.8] first-letter:font-semibold first-letter:text-primary",
      )}
    >
      {item.text}
    </p>
  );
}

function Ornament({ className, separator = false }: { className?: string; separator?: boolean }) {
  return (
    <div
      role={separator ? "separator" : undefined}
      aria-hidden={separator ? undefined : true}
      className={cn("flex items-center justify-center gap-[0.9em] text-[0.7rem] text-primary/55 select-none", className)}
    >
      <span aria-hidden>✦</span>
      <span aria-hidden>✦</span>
      <span aria-hidden>✦</span>
    </div>
  );
}
