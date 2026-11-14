"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { isProcessing } from "@/features/books/api";
import type { BookSummary } from "@/types/api";
import type { BookStatus } from "@/types/domain";

/**
 * Toasts when a book that was being prepared during this visit becomes ready
 * (or fails), and refreshes filtered lists that don't poll on their own.
 * Driven by the library's own polling — nothing is simulated.
 */
export function useReadyNotifications(books: BookSummary[] | undefined) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const previous = useRef<Map<string, BookStatus> | null>(null);

  useEffect(() => {
    if (!books) return;
    const before = previous.current;
    previous.current = new Map(books.map((book) => [book.id, book.status]));
    if (!before) return;

    let changed = false;
    for (const book of books) {
      const was = before.get(book.id);
      if (!was || !isProcessing(was) || isProcessing(book.status)) continue;
      changed = true;
      if (book.status === "READY") {
        toast.success(`“${book.title}” is ready`, {
          description: "Ask it anything — every answer cites the page it came from.",
          action: { label: "Open", onClick: () => router.push(`/books/${book.id}`) },
        });
      } else if (book.status === "FAILED") {
        toast.error(`We couldn’t prepare “${book.title}”`, {
          description: book.processingError ?? "You can try again from its card.",
        });
      }
    }
    if (changed) void queryClient.invalidateQueries({ queryKey: ["books", "list"] });
  }, [books, queryClient, router]);
}
