import Link from "next/link";

import { BookCover } from "@/components/books/book-cover";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-6">
      <div className="bg-editorial-wash pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div className="relative max-w-md text-center">
        <div className="mx-auto mb-8 flex w-fit items-end gap-2" aria-hidden>
          <BookCover title="Missing" palette={1} size="sm" className="-rotate-6" />
          <BookCover title="Page" palette={0} size="sm" />
          <BookCover title="404" palette={2} size="sm" className="rotate-6" />
        </div>
        <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">Not found</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">This page has wandered off the shelf</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The book or page you&apos;re looking for doesn&apos;t exist, or it isn&apos;t in the library.
        </p>
        <Button asChild className="mt-7 rounded-full">
          <Link href="/">Back to the library</Link>
        </Button>
      </div>
    </main>
  );
}
