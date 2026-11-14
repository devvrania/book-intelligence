"use client";

import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface PageNavigationProps {
  page: number;
  pageCount: number;
  /** Printed page label of the current page, when the PDF defines one. */
  pageLabel: string | null;
  loading: boolean;
  onNavigate: (page: number) => void;
  className?: string;
}

/** Previous / next, the "Page N of M" indicator and a jump-to-page field. */
export function PageNavigation({ page, pageCount, pageLabel, loading, onNavigate, className }: PageNavigationProps) {
  return (
    <nav aria-label="Pages" className={cn("flex items-center justify-between gap-2 sm:gap-4", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="h-10 rounded-full bg-card px-3 shadow-soft sm:px-4"
            disabled={page <= 1}
            onClick={() => onNavigate(page - 1)}
            aria-keyshortcuts="ArrowLeft"
          >
            <ChevronLeft />
            <span className="hidden sm:inline">Previous</span>
            <span className="sr-only sm:hidden">Previous page</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Previous page (←)</TooltipContent>
      </Tooltip>

      {/* Remounted per page so the field always starts at the current page. */}
      <PageJump key={page} page={page} pageCount={pageCount} pageLabel={pageLabel} loading={loading} onJump={onNavigate} />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            className="h-10 rounded-full bg-card px-3 shadow-soft sm:px-4"
            disabled={page >= pageCount}
            onClick={() => onNavigate(page + 1)}
            aria-keyshortcuts="ArrowRight"
          >
            <span className="hidden sm:inline">Next</span>
            <span className="sr-only sm:hidden">Next page</span>
            <ChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Next page (→)</TooltipContent>
      </Tooltip>
    </nav>
  );
}

function PageJump({
  page,
  pageCount,
  pageLabel,
  loading,
  onJump,
}: {
  page: number;
  pageCount: number;
  pageLabel: string | null;
  loading: boolean;
  onJump: (page: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(page));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const target = Number.parseInt(draft, 10);
    if (Number.isFinite(target) && target !== page) onJump(target);
    else setDraft(String(page));
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <label htmlFor={id}>Page</label>
      <Input
        id={id}
        inputMode="numeric"
        enterKeyHint="go"
        autoComplete="off"
        aria-describedby={`${id}-total`}
        value={draft}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 6))}
        onFocus={(event) => event.target.select()}
        onBlur={() => setDraft(String(page))}
        className="h-9 w-14 rounded-lg bg-card text-center text-sm text-foreground tabular-nums shadow-soft md:text-sm"
      />
      <span id={`${id}-total`} className="whitespace-nowrap tabular-nums">
        of {pageCount}
      </span>
      {pageLabel && (
        <span className="hidden rounded-full bg-muted px-2 py-0.5 text-xs whitespace-nowrap sm:inline">
          printed p. {pageLabel}
        </span>
      )}
      {loading ? (
        <LoaderCircle aria-hidden className="size-3.5 shrink-0 animate-spin opacity-70" />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
    </form>
  );
}
