"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { truncate } from "@/lib/documents/text-utils";
import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types/api";

import { citationNumber, sourceLocation } from "./source-utils";

export function CitationChip({
  label,
  source,
  onOpen,
}: {
  label: string;
  source?: SourceDTO;
  onOpen?: (source: SourceDTO) => void;
}) {
  const number = citationNumber(label);
  const chip = (
    <button
      type="button"
      onClick={source && onOpen ? () => onOpen(source) : undefined}
      disabled={!source}
      className={cn(
        "relative -top-[0.4em] mx-[1px] inline-flex h-[1.35em] min-w-[1.35em] items-center justify-center rounded-full px-[0.35em] align-baseline font-sans text-[0.68em] leading-none font-semibold tabular-nums transition",
        source
          ? "bg-rose-soft text-accent-foreground hover:bg-primary hover:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          : "bg-muted text-muted-foreground",
      )}
      aria-label={source ? `Source ${number}: ${sourceLocation(source)}` : `Source ${number}`}
    >
      {number}
    </button>
  );

  if (!source) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-left">
        <div className="text-[11px] font-medium opacity-80">{sourceLocation(source)}</div>
        <div className="mt-1 font-reading text-[13px] leading-snug italic">“{truncate(source.excerpt, 160)}”</div>
      </TooltipContent>
    </Tooltip>
  );
}
