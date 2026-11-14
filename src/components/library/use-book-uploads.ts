"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError } from "@/features/api/client";
import { bookKeys, uploadBook } from "@/features/books/api";

import { formatFileSize } from "./format";

export type UploadState = "queued" | "uploading" | "done";

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** Real upload progress (0–1) reported by the XHR. */
  progress: number;
  state: UploadState;
}

const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

/** How long a finished upload lingers (with its check mark) before it's cleared. */
const DONE_LINGER_MS = 1400;

/**
 * Client-side upload queue. Files are validated, then sent one at a time with
 * `uploadBook` so each gets real progress; failures surface as toasts.
 */
export function useBookUploads({ maxUploadBytes }: { maxUploadBytes?: number } = {}) {
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const queue = useRef<{ id: string; file: File }[]>([]);
  const running = useRef(false);
  const nextId = useRef(0);

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setUploads((items) => items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const discard = useCallback((id: string) => {
    setUploads((items) => items.filter((item) => item.id !== id));
  }, []);

  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (let next = queue.current.shift(); next; next = queue.current.shift()) {
        const { id, file } = next;
        patch(id, { state: "uploading", progress: 0 });
        try {
          const book = await uploadBook(file, (fraction) => patch(id, { progress: fraction }));
          patch(id, { state: "done", progress: 1 });
          toast.success(`We’re preparing “${book.title}” — this usually takes a minute`, {
            description: "Feel free to keep browsing. We’ll let you know when it’s ready.",
          });
          void queryClient.invalidateQueries({ queryKey: bookKeys.all });
          window.setTimeout(() => discard(id), DONE_LINGER_MS);
        } catch (error) {
          discard(id);
          toast.error(`Couldn’t add “${file.name}”`, {
            description: error instanceof ApiError ? error.message : "The upload failed. Please try again.",
          });
        }
      }
    } finally {
      running.current = false;
    }
  }, [discard, patch, queryClient]);

  const enqueue = useCallback(
    (files: Iterable<File>) => {
      const accepted: { id: string; file: File }[] = [];
      const notPdf: string[] = [];

      for (const file of files) {
        if (!isPdf(file)) {
          notPdf.push(file.name);
        } else if (file.size === 0) {
          toast.error(`“${file.name}” is empty`, { description: "Choose a PDF that has pages in it." });
        } else if (maxUploadBytes && file.size > maxUploadBytes) {
          toast.error(`“${file.name}” is too large`, {
            description: `Books can be up to ${formatFileSize(maxUploadBytes)}. This one is ${formatFileSize(file.size)}.`,
          });
        } else {
          nextId.current += 1;
          accepted.push({ id: `upload-${nextId.current}`, file });
        }
      }

      if (notPdf.length > 0) {
        toast.error(notPdf.length === 1 ? `“${notPdf[0]}” isn’t a PDF` : `${notPdf.length} files aren’t PDFs`, {
          description: "Only PDF files can be added to the library.",
        });
      }
      if (accepted.length === 0) return;

      setUploads((items) => [
        ...items,
        ...accepted.map(({ id, file }) => ({ id, name: file.name, size: file.size, progress: 0, state: "queued" as const })),
      ]);
      queue.current.push(...accepted);
      void drain();
    },
    [drain, maxUploadBytes],
  );

  const busy = uploads.some((item) => item.state !== "done");

  // Leaving the page would abort the request mid-upload.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  return { uploads, enqueue, busy };
}
