"use client";

import { Download, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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
import { useBookMutations } from "@/features/books/api";
import type { BookDetail } from "@/types/api";
import { allowBookChanges } from "@/lib/library/flags";

import { EditBookDialog } from "./edit-book-dialog";

export function BookActionsMenu({ book }: { book: BookDetail }) {
  const router = useRouter();
  const { remove, reprocess } = useBookMutations();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"delete" | "reprocess" | null>(null);

  const run = async () => {
    try {
      if (confirm === "delete") {
        await remove.mutateAsync(book.id);
        toast.success(`“${book.title}” was removed from the library`);
        router.push("/");
      } else if (confirm === "reprocess") {
        await reprocess.mutateAsync(book.id);
        toast.success("Reprocessing started");
        router.refresh();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setConfirm(null);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="size-9 rounded-full bg-card/70" aria-label="More actions">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {allowBookChanges && (
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil />
              Edit details
            </DropdownMenuItem>
          )}
          {book.fileUrl && (
            <DropdownMenuItem asChild>
              <a href={`${book.fileUrl}?download=1`}>
                <Download />
                Download PDF
              </a>
            </DropdownMenuItem>
          )}
          {(allowBookChanges || book.status === "FAILED") && (
            <DropdownMenuItem onSelect={() => setConfirm("reprocess")} disabled={book.status === "PROCESSING"}>
              <RefreshCw />
              Process again
            </DropdownMenuItem>
          )}
          {allowBookChanges && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm("delete")}>
                <Trash2 />
                Delete book
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditBookDialog key={`${book.id}-${editing}`} book={book} open={editing} onOpenChange={setEditing} />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? "Delete this book?" : "Process this book again?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete"
                ? `“${book.title}”, its pages, passages and every conversation about it will be permanently removed.`
                : "We'll re-read the PDF and rebuild its chapters, passages and search index. Existing conversations keep their citations."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void run();
              }}
              className={confirm === "delete" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            >
              {confirm === "delete" ? "Delete" : "Process again"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
