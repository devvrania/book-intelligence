import { Skeleton } from "@/components/ui/skeleton";

export default function BookLoading() {
  return (
    <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[330px_minmax(0,1fr)]" aria-busy="true" aria-label="Loading book">
      <aside className="hidden flex-col items-center gap-4 border-r border-border/60 px-6 py-7 lg:flex">
        <Skeleton className="aspect-[2/3] w-36 rounded-lg" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-28" />
        <div className="mt-4 w-full space-y-2.5">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-full rounded-xl" />
          ))}
        </div>
      </aside>
      <section className="flex flex-col px-4 py-10 sm:px-8">
        <div className="mx-auto w-full max-w-3xl space-y-4 pt-10">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <div className="grid gap-3 pt-6 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
