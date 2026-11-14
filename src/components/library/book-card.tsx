"use client";

import { motion } from "framer-motion";
import { BookOpen, Loader2, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { BookCover } from "@/components/books/book-cover";
import { BookStatusBadge } from "@/components/books/book-status-badge";
import { overallProgress, type ProcessingSnapshot } from "@/components/books/processing-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isProcessing, useBookMutations } from "@/features/books/api";
import { cn } from "@/lib/utils";
import type { BookSummary } from "@/types/api";
import { allowBookChanges } from "@/lib/library/flags";

import { formatRelativeTime, pluralize } from "./format";

export function BookCard({ book, now }: { book: BookSummary; now: number }) {
  const { remove, reprocess } = useBookMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const href = `/books/${book.id}`;
  const titleId = `book-${book.id}-title`;
  const processing = isProcessing(book.status);
  const failed = book.status === "FAILED";

  const retry = () =>
    reprocess.mutate(book.id, {
      onSuccess: () => toast(`Trying “${book.title}” again`, { description: "We’ll prepare it from the start." }),
      onError: (error) => toast.error("Couldn’t restart processing", { description: error.message }),
    });

  const handleDelete = async () => {
    setRemoving(true);
    try {
      await remove.mutateAsync(book.id);
      toast.success(`Removed “${book.title}” from the library`);
    } catch (error) {
      setRemoving(false);
      toast.error("Couldn’t delete this book", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  };

  return (
    <article
      aria-labelledby={titleId}
      aria-busy={removing || undefined}
      className={cn("group/card relative flex flex-col transition-opacity duration-300", removing && "pointer-events-none opacity-50")}
    >
      <Link
        href={href}
        className="flex flex-col rounded-[10px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      >
        <div className="relative transition-transform duration-500 ease-out group-hover/card:-translate-y-1 motion-reduce:transition-none motion-reduce:group-hover/card:translate-y-0">
          <BookCover
            title={book.title}
            author={book.author}
            coverUrl={book.coverUrl}
            seed={book.id}
            size="md"
            className={cn(
              "transition-[box-shadow,filter,opacity] duration-500 group-hover/card:shadow-lifted",
              failed && "opacity-80 saturate-[0.6]",
            )}
          />
          {processing && <ProcessingVeil snapshot={book} />}
          {removing && (
            <div className="absolute inset-0 flex items-center justify-center rounded-[3px_8px_8px_3px] bg-background/50">
              <Loader2 aria-hidden className="size-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="mt-3.5 min-w-0 px-0.5">
          <h3 id={titleId} className="line-clamp-2 font-display text-[0.95rem] leading-snug font-semibold text-foreground">
            {book.title}
          </h3>
          <p className={cn("mt-0.5 truncate text-[0.8rem] text-muted-foreground", !book.author && "italic opacity-80")}>
            {book.author ?? "Unknown author"}
          </p>
        </div>
      </Link>

      <div className="mt-2 px-0.5">
        {processing ? (
          <BookStatusBadge snapshot={book} className="max-w-full rounded-[0.8rem] leading-tight" />
        ) : failed ? (
          <FailedFooter book={book} onRetry={retry} retrying={reprocess.isPending} />
        ) : (
          <ReadyMeta book={book} now={now} />
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${book.title}`}
            className="absolute top-2 right-2 rounded-full bg-card/90 text-foreground/80 opacity-0 shadow-soft ring-1 ring-black/5 backdrop-blur transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 hover:bg-card hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={href}>
              <BookOpen aria-hidden />
              Open
            </Link>
          </DropdownMenuItem>
          {failed && (
            <DropdownMenuItem onSelect={retry} disabled={reprocess.isPending}>
              <RotateCcw aria-hidden />
              Try again
            </DropdownMenuItem>
          )}
          {allowBookChanges && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
                <Trash2 aria-hidden />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-lg font-semibold">Delete “{book.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The book, its passages and your conversations about it will be permanently removed. This can’t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep book</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void handleDelete()}>
              Delete book
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

/** Each item carries a leading "·"; the one starting a line is clipped by the negative margin. */
const META_ITEM = "before:inline-block before:w-3 before:text-center before:text-muted-foreground/50 before:content-['·']";

function ReadyMeta({ book, now }: { book: BookSummary; now: number }) {
  const opened = book.lastOpenedAt;
  return (
    <div className="overflow-hidden text-xs leading-relaxed text-muted-foreground/90">
      <p className="-ml-3 flex flex-wrap">
        {book.pageCount != null && (
          <span className={cn(META_ITEM, "tabular-nums")}>{pluralize(book.pageCount, "page")}</span>
        )}
        <time dateTime={opened ?? book.createdAt} suppressHydrationWarning className={META_ITEM}>
          {opened ? `Opened ${formatRelativeTime(opened, now)}` : `Added ${formatRelativeTime(book.createdAt, now)}`}
        </time>
      </p>
    </div>
  );
}

function FailedFooter({ book, onRetry, retrying }: { book: BookSummary; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="space-y-2">
      <BookStatusBadge snapshot={book} />
      {book.processingError && (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground" title={book.processingError}>
          {book.processingError}
        </p>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={retrying}
        className="rounded-full border-primary/20 bg-card text-accent-foreground hover:border-primary/35 hover:bg-accent"
      >
        {retrying ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden />}
        Try again
      </Button>
    </div>
  );
}

/** Soft veil + live progress line over the cover of a book that's being prepared. */
function ProcessingVeil({ snapshot }: { snapshot: ProcessingSnapshot }) {
  const fraction = overallProgress(snapshot);
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[3px_8px_8px_3px]">
      <div className="absolute inset-0 bg-background/40 backdrop-blur-[1.5px]" />
      <div className="absolute inset-0 animate-shimmer bg-linear-to-r from-transparent via-card/45 to-transparent bg-size-[200%_100%] motion-reduce:animate-none" />
      <div className="absolute inset-x-[12%] bottom-[9%] h-1 overflow-hidden rounded-full bg-card/70 shadow-soft">
        <motion.div
          className="h-full rounded-full bg-linear-to-r from-primary/80 to-lavender"
          initial={false}
          animate={{ width: `${Math.max(6, fraction * 100)}%` }}
          transition={{ type: "spring", stiffness: 70, damping: 20 }}
        />
      </div>
    </div>
  );
}
