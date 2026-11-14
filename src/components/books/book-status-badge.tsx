import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { processingLabel, type ProcessingSnapshot } from "./processing-state";

export function BookStatusBadge({ snapshot, className }: { snapshot: ProcessingSnapshot; className?: string }) {
  const { status } = snapshot;
  const base = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none";

  if (status === "READY") {
    return (
      <span className={cn(base, "bg-sage-soft text-sage", className)}>
        <CheckCircle2 className="size-3" aria-hidden />
        Ready
      </span>
    );
  }
  if (status === "FAILED") {
    return (
      <span className={cn(base, "bg-destructive/10 text-destructive", className)}>
        <AlertCircle className="size-3" aria-hidden />
        Needs attention
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-lavender-soft text-secondary-foreground", className)}>
      <Loader2 className="size-3 animate-spin" aria-hidden />
      {processingLabel(snapshot)}
    </span>
  );
}
