"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, MotionConfig, motion, useReducedMotion, type Variants } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { api, ApiError } from "@/features/api/client";
import { bookKeys, usePage, usePassage } from "@/features/books/api";
import { cn } from "@/lib/utils";
import type { BookDetail, ChapterSummary, PageDTO } from "@/types/api";

import { ChapterList } from "./chapter-list";
import { PageContent } from "./page-content";
import { PageNavigation } from "./page-navigation";
import { PageSkeleton } from "./reader-skeleton";
import { chapterForPage, chapterLine, clampPage, createPassageMatcher } from "./reader-text";
import { ReaderTopBar } from "./reader-top-bar";

export interface ReaderViewProps {
  book: BookDetail;
  initialPage: number;
  /** Passage (chunk id) to highlight (`?passage=`), e.g. when arriving from a citation. */
  initialPassageId?: string | null;
  /** The initial page, rendered on the server, so the first paint needs no request. */
  initialPageData?: PageDTO | null;
}

type ScrollTarget = { kind: "highlight" | "top"; page: number } | null;

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const pageVariants: Variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 18 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.3, ease: EASE_OUT } },
  exit: (direction: number) => ({ opacity: 0, x: direction * -10, transition: { duration: 0.12, ease: "easeIn" } }),
};

/** Keyboard shortcuts never fire while the reader is typing or using a composite widget. */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest("input, textarea, select, [contenteditable], [role='combobox'], [role='listbox'], [role='menu']") !== null;
}

/**
 * Reader mode: the book's pages with chapter navigation. Arriving from an answer's citation (`?passage=`)
 * highlights the cited passage, so the reader can check the answer against the book.
 */
export function ReaderView({ book, initialPage, initialPassageId = null, initialPageData = null }: ReaderViewProps) {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const bookPageCount = Math.max(1, book.pageCount ?? book.chapters.at(-1)?.endPage ?? initialPage);
  const startPage = clampPage(initialPage, bookPageCount);

  // Seed the cache with the server-rendered page (once, before the first query subscribes).
  useState(() => {
    if (!initialPageData) return null;
    const key = bookKeys.page(book.id, initialPageData.pageNumber);
    if (queryClient.getQueryData(key) === undefined) queryClient.setQueryData(key, initialPageData);
    return null;
  });

  const [page, setPage] = useState(startPage);
  const [direction, setDirection] = useState(1);
  const [passage, setPassage] = useState<{ id: string; anchorPage: number } | null>(
    initialPassageId ? { id: initialPassageId, anchorPage: startPage } : null,
  );
  const [contentsOpen, setContentsOpen] = useState(false);
  const [scrollRequest, setScrollRequest] = useState(0);
  const scrollTarget = useRef<ScrollTarget>(initialPassageId ? { kind: "highlight", page: startPage } : null);
  const articleRef = useRef<HTMLElement>(null);

  // --- Data ------------------------------------------------------------------

  const pageQuery = usePage(book.id, page);
  /** The page on screen; while the next one loads this is still the previous page. */
  const shown = pageQuery.data;
  const isCurrent = shown?.pageNumber === page;
  const turning = !!shown && !isCurrent;
  const pageCount = Math.max(1, shown?.pageCount ?? bookPageCount);

  const passageQuery = usePassage(book.id, passage?.id ?? null);
  const passageData = passage && passageQuery.data?.chunkId === passage.id ? passageQuery.data : undefined;
  const highlightsPending = !!passage && passageQuery.isPending;

  const highlights = useMemo(() => {
    const inPassage =
      !!shown && !!passageData && shown.pageNumber >= passageData.pageStart && shown.pageNumber <= passageData.pageEnd;
    const isPassageText = passageData && inPassage ? createPassageMatcher(passageData.content, passageData.overlapChars) : null;
    return { isPassageText };
  }, [shown, passageData]);

  // --- Navigation ------------------------------------------------------------

  const goTo = useCallback(
    (target: number) => {
      const next = clampPage(target, pageCount);
      if (passage) {
        // A passage highlight only lasts while the reader stays within its pages.
        const start = passageData?.pageStart ?? passage.anchorPage;
        const end = passageData?.pageEnd ?? passage.anchorPage;
        if (next < start || next > end) setPassage(null);
      }
      scrollTarget.current = { kind: "top", page: next };
      setScrollRequest((count) => count + 1);
      if (next !== page) {
        setDirection(next > page ? 1 : -1);
        setPage(next);
      }
    },
    [page, pageCount, passage, passageData],
  );

  /** After a page renders: bring the highlighted passage into view, or the top of the page after a page turn. */
  const handleRendered = useCallback(
    (root: HTMLElement, renderedPage: number) => {
      const target = scrollTarget.current;
      if (!target || target.page !== renderedPage) return;
      scrollTarget.current = null;
      if (target.kind === "highlight") {
        const hit = root.querySelector<HTMLElement>("[data-reader-hit]");
        if (hit) {
          hit.scrollIntoView({ block: "start", behavior: reduceMotion ? "auto" : "smooth" });
          return;
        }
      }
      const article = articleRef.current;
      if (article && article.getBoundingClientRect().top < 100) article.scrollIntoView({ block: "start" });
    },
    [reduceMotion],
  );

  // Keep the URL shareable: ?page=N, plus passage while it applies to this page.
  const passageApplies =
    !!passage && (!passageData || (page >= passageData.pageStart && page <= passageData.pageEnd));
  useEffect(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (passage && passageApplies) params.set("passage", passage.id);
    const next = `${window.location.pathname}?${params}`;
    if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
  }, [page, passage, passageApplies]);

  // Prefetch the neighbouring pages once this one is on screen, so page turns are instant.
  useEffect(() => {
    if (!isCurrent) return;
    for (const neighbour of [page + 1, page - 1]) {
      if (neighbour < 1 || neighbour > pageCount) continue;
      void queryClient.prefetchQuery({
        queryKey: bookKeys.page(book.id, neighbour),
        queryFn: () => api<PageDTO>(`/api/books/${book.id}/pages/${neighbour}`),
        staleTime: 5 * 60_000,
      });
    }
  }, [book.id, page, pageCount, isCurrent, queryClient]);

  // ← / → turn pages.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (contentsOpen || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "ArrowLeft" && page > 1) {
        event.preventDefault();
        goTo(page - 1);
      } else if (event.key === "ArrowRight" && page < pageCount) {
        event.preventDefault();
        goTo(page + 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goTo, page, pageCount, contentsOpen]);

  // --- Render ----------------------------------------------------------------

  const shownPage = shown?.pageNumber ?? page;
  const currentChapter = chapterForPage(book.chapters, page);
  const firstChapterStart = book.chapters[0]?.startPage ?? 1;
  const chapterText = currentChapter
    ? chapterLine(currentChapter.label, currentChapter.title)
    : book.chapters.length > 0 && page < firstChapterStart
      ? "Front matter"
      : null;

  const openChapter = (chapter: ChapterSummary) => {
    setContentsOpen(false);
    goTo(chapter.startPage);
  };

  const pageError =
    pageQuery.error instanceof ApiError ? pageQuery.error.message : "Something went wrong while loading this page.";
  const announcement =
    shown && isCurrent ? `Page ${shown.pageNumber} of ${pageCount}${chapterText ? `, ${chapterText}` : ""}` : "";

  let content: React.ReactNode;
  if (shown) {
    content = (
      <AnimatePresence mode="wait" initial={false} custom={direction}>
        <motion.div
          key={shown.pageNumber}
          custom={direction}
          variants={pageVariants}
          className="flex flex-1 flex-col"
          initial="enter"
          animate="center"
          exit="exit"
        >
          <PageContent
            page={shown}
            bookTitle={book.title}
            highlights={highlights}
            highlightsPending={highlightsPending}
            scrollRequest={scrollRequest}
            onRendered={handleRendered}
          />
        </motion.div>
      </AnimatePresence>
    );
  } else if (pageQuery.isError) {
    content = (
      <div role="alert" className="flex flex-col items-center py-20 text-center">
        <p className="font-display text-xl font-semibold text-foreground">This page couldn’t be opened</p>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{pageError}</p>
        <Button variant="outline" className="mt-6 rounded-full" onClick={() => void pageQuery.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else {
    content = <PageSkeleton />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex flex-1 flex-col">
        <h1 className="sr-only">
          {book.title}
          {book.author ? ` by ${book.author}` : ""} — reader
        </h1>

        <ReaderTopBar
          book={book}
          chapterText={chapterText}
          progress={page / pageCount}
          onOpenContents={() => setContentsOpen(true)}
        />

        <div className="mx-auto grid w-full max-w-[1400px] flex-1 items-start gap-8 px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:grid-cols-[15.5rem_minmax(0,1fr)] 2xl:grid-cols-[16rem_minmax(0,1fr)_16rem]">
          <aside className="sticky top-[7.75rem] hidden lg:block">
            <nav
              aria-label="Chapters"
              className="flex max-h-[calc(100dvh-9rem)] flex-col rounded-2xl border border-border/70 bg-card/70 shadow-soft"
            >
              <p className="px-4 pt-4 pb-2 text-[0.66rem] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
                Contents
              </p>
              <ChapterList
                chapters={book.chapters}
                currentChapterId={currentChapter?.id ?? null}
                onSelect={openChapter}
                className="min-h-0 flex-1 px-2 pb-2"
              />
              <ReadingProgress page={page} pageCount={pageCount} className="border-t border-border/70 px-4 py-3" />
            </nav>
          </aside>

          <div className="min-w-0">
            <article
              ref={articleRef}
              aria-label={`Page ${shownPage}`}
              aria-busy={turning || undefined}
              className="relative mx-auto flex min-h-[min(72vh,52rem)] max-w-[48rem] scroll-mt-32 flex-col rounded-[1.75rem] border border-border/70 bg-card bg-paper-grain shadow-soft"
            >
              <div
                className={cn(
                  "flex flex-1 flex-col px-6 py-10 transition-opacity duration-300 sm:px-12 sm:py-14 lg:px-16",
                  turning && "opacity-55 delay-150",
                )}
              >
                {content}
              </div>
            </article>

            <PageNavigation
              className="mx-auto mt-6 max-w-[48rem]"
              page={page}
              pageCount={pageCount}
              pageLabel={isCurrent ? (shown?.pageLabel ?? null) : null}
              loading={turning}
              onNavigate={goTo}
            />
          </div>
        </div>

        <p aria-live="polite" aria-atomic className="sr-only">
          {announcement}
        </p>
      </main>

      {/* Table of contents on small screens */}
      <Sheet open={contentsOpen} onOpenChange={setContentsOpen}>
        <SheetContent side="left" className="gap-0 data-[side=left]:w-[86%] data-[side=left]:max-w-xs">
          <SheetHeader className="px-5 pt-5 pb-3">
            <SheetTitle className="font-display text-lg font-semibold">Contents</SheetTitle>
            <SheetDescription>
              {book.chapters.length} {book.chapters.length === 1 ? "chapter" : "chapters"} · {pageCount} pages
            </SheetDescription>
          </SheetHeader>
          <ChapterList
            chapters={book.chapters}
            currentChapterId={currentChapter?.id ?? null}
            onSelect={openChapter}
            className="min-h-0 flex-1 px-2 pb-2"
          />
          <ReadingProgress page={page} pageCount={pageCount} className="border-t border-border/70 px-5 py-4" />
        </SheetContent>
      </Sheet>
    </MotionConfig>
  );
}

function ReadingProgress({ page, pageCount, className }: { page: number; pageCount: number; className?: string }) {
  const percent = Math.round((Math.min(page, pageCount) / pageCount) * 100);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-[0.7rem] text-muted-foreground">
        <span>
          Page {page} of {pageCount}
        </span>
        <span className="tabular-nums">{percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-full rounded-full bg-primary/60 transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
