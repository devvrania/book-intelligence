"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/features/api/client";
import type { BookDetail, BookListResponse, BookSummary, PageDTO, PassageDTO } from "@/types/api";
import type { BookStatus } from "@/types/domain";

export const bookKeys = {
  all: ["books"] as const,
  list: (params: LibraryParams) => ["books", "list", params] as const,
  detail: (id: string) => ["books", "detail", id] as const,
  status: (id: string) => ["books", "status", id] as const,
  page: (id: string, page: number) => ["books", "page", id, page] as const,
  passage: (id: string, chunkId: string) => ["books", "passage", id, chunkId] as const,
};

export interface LibraryParams {
  q?: string;
  status?: BookStatus;
  sort?: "recent" | "opened" | "title";
}

export const isProcessing = (status: BookStatus) => status === "UPLOADING" || status === "PROCESSING";

export function useLibrary(params: LibraryParams, initialData?: BookListResponse) {
  return useQuery({
    queryKey: bookKeys.list(params),
    queryFn: () => {
      const search = new URLSearchParams();
      if (params.q) search.set("q", params.q);
      if (params.status) search.set("status", params.status);
      if (params.sort) search.set("sort", params.sort);
      search.set("limit", "60");
      return api<BookListResponse>(`/api/books?${search}`);
    },
    initialData: params.q || params.status || (params.sort && params.sort !== "recent") ? undefined : initialData,
    placeholderData: keepPreviousData,
    // Keep processing cards live without a websocket.
    refetchInterval: (query) => (query.state.data?.items.some((book) => isProcessing(book.status)) ? 2000 : false),
  });
}

export function useBook(bookId: string, initialData?: BookDetail) {
  return useQuery({
    queryKey: bookKeys.detail(bookId),
    queryFn: () => api<BookDetail>(`/api/books/${bookId}`),
    initialData,
    refetchInterval: (query) => (query.state.data && isProcessing(query.state.data.status) ? 1500 : false),
  });
}

export function usePage(bookId: string, page: number) {
  return useQuery({
    queryKey: bookKeys.page(bookId, page),
    queryFn: () => api<PageDTO>(`/api/books/${bookId}/pages/${page}`),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function usePassage(bookId: string, chunkId: string | null) {
  return useQuery({
    queryKey: bookKeys.passage(bookId, chunkId ?? ""),
    queryFn: () => api<PassageDTO>(`/api/books/${bookId}/passages/${chunkId}`),
    enabled: !!chunkId,
    staleTime: 10 * 60_000,
  });
}

export function useBookMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: bookKeys.all });

  return {
    remove: useMutation({
      mutationFn: (bookId: string) => api<void>(`/api/books/${bookId}`, { method: "DELETE" }),
      onSuccess: invalidate,
    }),
    reprocess: useMutation({
      mutationFn: (bookId: string) => api<BookSummary>(`/api/books/${bookId}/process`, { method: "POST" }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ bookId, ...json }: { bookId: string; title?: string; author?: string | null; description?: string | null }) =>
        api<BookSummary>(`/api/books/${bookId}`, { method: "PATCH", json }),
      onSuccess: invalidate,
    }),
  };
}

/**
 * Two-step upload: create the Book record, then PUT the bytes with XHR so we
 * can report real upload progress (fetch has no upload progress events).
 */
export async function uploadBook(file: File, onProgress: (fraction: number) => void): Promise<BookSummary> {
  const book = await api<BookSummary>("/api/books", {
    method: "POST",
    json: { filename: file.name, fileSize: file.size },
  });

  const upload = new Promise<BookSummary>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/books/${book.id}/upload`);
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // ignore
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve(body as BookSummary);
      } else {
        const error = (body as { error?: { code: string; message: string } } | null)?.error;
        reject(new ApiError(xhr.status, error?.code ?? "upload_failed", error?.message ?? "The upload failed. Please try again."));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "network_error", "The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });

  try {
    return await upload;
  } catch (error) {
    // Don't leave an empty "uploading" book behind.
    void api(`/api/books/${book.id}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}
