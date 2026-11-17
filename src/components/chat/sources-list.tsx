"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BookOpenText, ChevronDown } from "lucide-react";
import { useState } from "react";

import { truncate } from "@/lib/documents/text-utils";
import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types/api";

import { chapterLabelOf, chapterSubtitleOf, citationNumber, pageLabelOf, sourceLocation } from "./source-utils";

export function SourceCard({ source, onOpen, compact }: { source: SourceDTO; onOpen: (source: SourceDTO) => void; compact?: boolean }) {
  const subtitle = chapterSubtitleOf(source);
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      className="group flex w-full gap-3 rounded-2xl border border-border/80 bg-card px-3.5 py-3 text-left shadow-soft transition hover:-translate-y-px hover:border-primary/30 hover:shadow-lifted focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
    >
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-soft text-[10px] font-semibold text-accent-foreground tabular-nums">
        {citationNumber(source.label)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2 text-xs font-medium text-foreground">
          {sourceLocation(source)}
          {subtitle && <span className="truncate font-normal text-muted-foreground">{subtitle}</span>}
        </span>
        <span className={cn("mt-1 block font-reading text-[0.92rem] leading-snug text-foreground/80 italic", compact ? "line-clamp-2" : "line-clamp-3")}>
          “{truncate(source.excerpt, compact ? 160 : 260)}”
        </span>
      </span>
    </button>
  );
}

/**
 * A one-line source chip: citation number, pages, chapter. Pages come first so a long chapter name is what gets cut
 * off, never the page numbers. Opens the passage like a card does.
 */
function SourcePill({ source, onOpen }: { source: SourceDTO; onOpen: (source: SourceDTO) => void }) {
  const location = sourceLocation(source);
  const pages = pageLabelOf(source).replace(/^Pages? /, "p. ");
  const chapter = chapterLabelOf(source);
  return (
    <button
      type="button"
      onClick={() => onOpen(source)}
      title={location}
      className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border/80 bg-card py-1 pr-3 pl-1 text-xs text-foreground/80 shadow-soft transition hover:border-primary/30 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none sm:max-w-[18rem]"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-rose-soft text-[10px] font-semibold text-accent-foreground tabular-nums">
        {citationNumber(source.label)}
      </span>
      <span className="shrink-0 tabular-nums">{pages}</span>
      {chapter && <span className="truncate text-muted-foreground">· {chapter}</span>}
    </button>
  );
}

/**
 * Sources under an answer, compact by default: one row of pills (number + place in the book), each opening its
 * passage, so answers aren't pushed apart by a grid of cards. "Show passages" expands to cards with excerpts, plus
 * the passages that were retrieved and shown to the model but not cited.
 */
export function SourcesList({
  sources,
  onOpen,
  compact,
}: {
  sources: SourceDTO[];
  onOpen: (source: SourceDTO) => void;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  if (sources.length === 0) return null;

  const cited = sources.filter((source) => source.cited);
  const primary = cited.length > 0 ? cited : sources;
  const others = cited.length > 0 ? sources.filter((source) => !source.cited) : [];

  return (
    <section aria-label="Sources" className="mt-5 border-t border-border/70 pt-4">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          <BookOpenText className="size-3.5" aria-hidden />
          {cited.length > 0 ? "Sources" : "Passages consulted"}
        </h4>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? "Hide passages" : "Show passages"}
          <ChevronDown className={cn("size-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
        </button>
      </div>

      {!expanded && (
        <div className="flex flex-wrap gap-1.5">
          {primary.map((source) => (
            <SourcePill key={source.label} source={source} onOpen={onOpen} />
          ))}
          {others.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setExpanded(true);
                setShowOthers(true);
              }}
              className="rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              +{others.length} more consulted
            </button>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className={cn("grid gap-2", !compact && "sm:grid-cols-2")}>
              {primary.map((source) => (
                <SourceCard key={source.label} source={source} onOpen={onOpen} compact={compact} />
              ))}
            </div>

            {others.length > 0 && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => setShowOthers((value) => !value)}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  aria-expanded={showOthers}
                >
                  <ChevronDown className={cn("size-3.5 transition-transform", showOthers && "rotate-180")} aria-hidden />
                  {others.length} more {others.length === 1 ? "passage" : "passages"} consulted
                </button>
                <AnimatePresence initial={false}>
                  {showOthers && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className={cn("grid gap-2 pt-2", !compact && "sm:grid-cols-2")}>
                        {others.map((source) => (
                          <SourceCard key={source.label} source={source} onOpen={onOpen} compact />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
