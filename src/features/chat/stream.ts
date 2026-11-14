import { toApiError } from "@/features/api/client";
import type { ChatRequestBody, ChatStreamEvent } from "@/types/api";

/**
 * POST a question and consume the newline-delimited JSON event stream.
 * Errors raised before streaming (auth, validation, rate limit) arrive as a
 * regular JSON error response and are thrown as ApiError.
 */
export async function streamChat(
  bookId: string,
  body: ChatRequestBody,
  options: { signal?: AbortSignal; onEvent: (event: ChatStreamEvent) => void },
): Promise<void> {
  const response = await fetch(`/api/books/${bookId}/chat`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  if (!response.ok) throw await toApiError(response);
  if (!response.body) throw new Error("The response had no body");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) options.onEvent(JSON.parse(line) as ChatStreamEvent);
      newline = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) options.onEvent(JSON.parse(rest) as ChatStreamEvent);
}
