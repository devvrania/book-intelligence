"use client";

import { motion } from "framer-motion";
import { RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useBookMutations } from "@/features/books/api";
import { allowBookChanges } from "@/lib/library/flags";
import type { BookDetail } from "@/types/api";

import { BookCover } from "./book-cover";
import { overallProgress, processingHeadline, processingLabel } from "./processing-state";

/** Shown while a book is being prepared (or after processing failed). Live via polling. */
export function BookProcessingView({ book }: { book: BookDetail }) {
  const router = useRouter();
  const { reprocess, remove } = useBookMutations();
  const failed = book.status === "FAILED";

  const retry = async () => {
    try {
      await reprocess.mutateAsync(book.id);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't restart processing.");
    }
  };

  const discard = async () => {
    try {
      await remove.mutateAsync(book.id);
      toast.success("Book removed");
      router.push("/");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete the book.");
    }
  };

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-16">
      <div className="bg-editorial-wash pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative grid w-full max-w-2xl gap-10 rounded-[2rem] border border-border/80 bg-card/90 p-8 shadow-lifted backdrop-blur sm:grid-cols-[auto_1fr] sm:p-10"
      >
        <div className="mx-auto w-32 sm:mx-0">
          <motion.div animate={failed ? undefined : { y: [0, -4, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
            <BookCover title={book.title} author={book.author} coverUrl={book.coverUrl} seed={book.id} />
          </motion.div>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">{failed ? "Something went wrong" : "Hang tight"}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{processingHeadline(book)}</h1>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{book.title}</p>

          {!failed && <ProcessingBar book={book} />}

          {failed ? (
            <div className="mt-7 space-y-4">
              {book.processingError && (
                <p className="rounded-2xl border border-destructive/15 bg-destructive/5 px-4 py-3 text-sm text-foreground">{book.processingError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button onClick={retry} disabled={reprocess.isPending} className="rounded-full">
                  <RefreshCw />
                  Try again
                </Button>
                {allowBookChanges && (
                  <Button variant="ghost" onClick={discard} disabled={remove.isPending} className="rounded-full text-muted-foreground">
                    <Trash2 />
                    Remove book
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-7 text-xs leading-relaxed text-muted-foreground">
              We&apos;re reading every page, finding the chapters and indexing passages so answers can cite exactly where they
              come from. You can leave this page — processing continues in the background.
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/** One bar for the whole preparation, with the current step's name under it. */
function ProcessingBar({ book }: { book: BookDetail }) {
  const percent = Math.round(overallProgress(book) * 100);
  return (
    <div className="mt-7">
      <div
        role="progressbar"
        aria-label="Preparing the book"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out" style={{ width: `${Math.max(percent, 4)}%` }} />
      </div>
      <p className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>{processingLabel(book)}</span>
        <span className="tabular-nums">{percent}%</span>
      </p>
    </div>
  );
}
