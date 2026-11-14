"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBookMutations } from "@/features/books/api";
import type { BookDetail } from "@/types/api";

export function EditBookDialog({ book, open, onOpenChange }: { book: BookDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { update } = useBookMutations();
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? "");
  const [description, setDescription] = useState(book.description ?? "");

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await update.mutateAsync({
        bookId: book.id,
        title: title.trim(),
        author: author.trim() || null,
        description: description.trim() || null,
      });
      toast.success("Book details updated");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save your changes.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-5">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Edit book details</DialogTitle>
            <DialogDescription>These are detected automatically from the PDF. Adjust them if anything looks off.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="book-title">Title</Label>
            <Input id="book-title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="book-author">Author</Label>
            <Input id="book-author" value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={300} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="book-description">Description</Label>
            <Textarea id="book-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={4000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending || !title.trim()}>
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
