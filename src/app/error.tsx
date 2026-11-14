"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Details stay in the console/server logs; the reader only sees a friendly message.
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70dvh] flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">Something went wrong</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">We lost our place for a moment</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This page couldn&apos;t be loaded. It&apos;s usually temporary — please try again.
          {error.digest && <span className="mt-2 block text-xs opacity-70">Reference: {error.digest}</span>}
        </p>
        <div className="mt-7 flex justify-center gap-2">
          <Button onClick={() => retry()} className="rounded-full">
            <RotateCcw />
            Try again
          </Button>
          <Button asChild variant="ghost" className="rounded-full">
            <Link href="/">Go to the library</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
