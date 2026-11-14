import { cn } from "@/lib/utils";

/** Shared layout classes so the skeleton lines up exactly with the real page. */
export const PAGE_CONTAINER = "mx-auto w-full max-w-[1400px] px-4 sm:px-6";
export const BOOK_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-9 min-[480px]:gap-x-5 sm:grid-cols-3 sm:gap-x-6 sm:gap-y-10 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

/** Soft blush/lavender wash behind the top of the dashboard. */
export function LibraryBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[26rem] overflow-hidden">
      <div className="absolute inset-0 bg-editorial-wash opacity-80" />
      <div className="absolute inset-0 bg-paper-grain opacity-60" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-linear-to-b from-transparent to-background" />
    </div>
  );
}

function Bar({ className }: { className?: string }) {
  return <div className={cn("skeleton-shimmer rounded-full", className)} />;
}

export function BookCardSkeleton() {
  return (
    <div>
      <div className="skeleton-shimmer aspect-[2/3] rounded-[3px_8px_8px_3px]" />
      <Bar className="mt-4 h-3.5 w-4/5" />
      <Bar className="mt-2 h-3 w-1/2" />
      <Bar className="mt-3 h-2.5 w-2/3 opacity-70" />
    </div>
  );
}

export function BookGridSkeleton({ count = 12, className }: { count?: number; className?: string }) {
  return (
    <ul className={cn(BOOK_GRID, className)} aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <BookCardSkeleton />
        </li>
      ))}
    </ul>
  );
}

/** Full-page placeholder used by the route's loading state. */
export function LibrarySkeleton() {
  return (
    <div className="relative isolate flex-1" role="status" aria-label="Loading the library">
      <LibraryBackdrop />
      <div className={cn(PAGE_CONTAINER, "pt-10 pb-16 sm:pt-14")}>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Bar className="h-5 w-44" />
            <Bar className="mt-4 h-11 w-64 sm:h-12 sm:w-80" />
            <Bar className="mt-4 h-4 w-28" />
          </div>
          <Bar className="h-10 w-36" />
        </div>

        <div className="mt-12 flex flex-col gap-3 lg:flex-row lg:items-center">
          <Bar className="h-10 w-full lg:w-80" />
          <Bar className="h-10 w-full max-w-md" />
          <Bar className="h-10 w-40 lg:ml-auto" />
        </div>

        <BookGridSkeleton className="mt-8" />
      </div>
      <span className="sr-only">Loading the library…</span>
    </div>
  );
}
