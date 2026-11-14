import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Widths of the placeholder lines, so the skeleton reads like a page of prose. */
const PARAGRAPHS = [
  ["w-[96%]", "w-full", "w-[92%]", "w-[98%]", "w-2/5"],
  ["w-full", "w-[94%]", "w-[97%]", "w-3/4"],
  ["w-[93%]", "w-full", "w-[95%]", "w-[90%]", "w-[97%]", "w-1/2"],
  ["w-[98%]", "w-[91%]", "w-3/5"],
];

/** Placeholder for one page of text. */
export function PageSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("mx-auto max-w-[65ch]", className)}>
      <span role="status" className="sr-only">
        Loading page…
      </span>
      <div aria-hidden>
        <div className="mb-10 flex justify-between gap-6 border-b border-border/60 pb-3">
          <Skeleton className="h-2.5 w-28" />
          <Skeleton className="h-2.5 w-36" />
        </div>
        <div className="space-y-7">
          {PARAGRAPHS.map((lines, p) => (
            <div key={p} className="space-y-3">
              {lines.map((width, l) => (
                <Skeleton key={l} className={cn("h-3.5 rounded-full bg-muted/90", width, l === 0 && "ml-[1.6em]")} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Full reader layout placeholder (route loading state). */
export function ReaderSkeleton() {
  return (
    <div className="flex flex-1 flex-col" aria-busy>
      <div className="sticky top-14 z-30 border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1400px] items-center gap-3 px-3 sm:px-6">
          <Skeleton className="ml-1 h-4 w-4 rounded-full" />
          <Skeleton className="h-10 w-7 rounded-[3px_6px_6px_3px]" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Skeleton className="h-8 w-20 rounded-lg" />
            <Skeleton className="h-8 w-24 rounded-full" />
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 gap-8 px-4 pt-6 pb-16 sm:px-6 sm:pt-8 lg:grid-cols-[15.5rem_minmax(0,1fr)] 2xl:grid-cols-[16rem_minmax(0,1fr)_16rem]">
        <div aria-hidden className="hidden lg:block">
          <div className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-soft">
            <Skeleton className="mb-4 h-2.5 w-20" />
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="space-y-1.5 py-1.5">
                <Skeleton className="h-2 w-16" />
                <Skeleton className={cn("h-3", i % 3 === 0 ? "w-4/5" : i % 3 === 1 ? "w-3/5" : "w-2/3")} />
              </div>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          <div className="mx-auto max-w-[48rem] rounded-[1.75rem] border border-border/70 bg-card px-6 py-10 shadow-soft sm:px-12 sm:py-14 lg:px-16">
            <PageSkeleton />
          </div>
          <div aria-hidden className="mx-auto mt-6 flex max-w-[48rem] items-center justify-between">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-9 w-36 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
