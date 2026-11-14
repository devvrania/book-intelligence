"use client";

import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useBookMutations } from "@/features/books/api";
import { describeEmbeddingModel } from "@/lib/embeddings/model-id";

/**
 * Shown when a book's vectors were produced by a different embedding model
 * than the one configured now (e.g. after switching from OpenAI to Ollama).
 * Questions need the book re-indexed with the current model.
 */
export function ReindexBanner({ bookId, indexedWith, current }: { bookId: string; indexedWith: string; current: string }) {
  const { reprocess } = useBookMutations();

  const reindex = async () => {
    try {
      await reprocess.mutateAsync(bookId);
      toast.success("Re-indexing started — this usually takes a minute.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start re-indexing.");
    }
  };

  return (
    <div role="status" className="mx-4 mt-4 flex flex-col gap-3 rounded-2xl border border-amber/25 bg-amber-soft px-4 py-3 text-sm sm:mx-8 sm:flex-row sm:items-center">
      <p className="flex-1 leading-relaxed text-foreground">
        This book was indexed with <strong className="font-medium">{describeEmbeddingModel(indexedWith)}</strong>, but the app
        now uses <strong className="font-medium">{describeEmbeddingModel(current)}</strong>. Re-index it to keep asking
        questions — your conversations are kept.
      </p>
      <Button size="sm" className="shrink-0 rounded-full" onClick={reindex} disabled={reprocess.isPending}>
        <RefreshCw className={reprocess.isPending ? "animate-spin" : undefined} />
        Re-index now
      </Button>
    </div>
  );
}
