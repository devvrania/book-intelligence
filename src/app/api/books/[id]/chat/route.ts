import { z } from "zod";

import { logger } from "@/lib/logger";
import { getServices } from "@/server/container";
import { parseId, parseJson, withLibrary } from "@/server/http/handler";
import type { ChatStreamEvent } from "@/types/api";

const chatBody = z.object({
  message: z.string().trim().min(1, "Please enter a question.").max(4000, "That question is too long."),
  conversationId: z.uuid().nullish(),
  chapterId: z.uuid().nullish(),
  selection: z
    .object({
      text: z.string().max(8000).nullish(),
      pageNumber: z.number().int().positive().nullish(),
    })
    .nullish(),
});

/**
 * POST /api/books/:id/chat — ask a question about a book.
 *
 * Responds with a newline-delimited JSON stream of ChatStreamEvent:
 * conversation → status → sources → delta… → done (or error).
 * Validation, auth and rate-limit failures are regular JSON errors because
 * they are raised in `prepare()`, before streaming starts.
 */
export const POST = withLibrary(async (request, context: RouteContext<"/api/books/[id]/chat">) => {
  const bookId = parseId((await context.params).id, "Book");
  const body = await parseJson(request, chatBody);
  const chat = getServices().chat;

  const prepared = await chat.prepare({
    bookId,
    message: body.message,
    conversationId: body.conversationId,
    chapterId: body.chapterId,
    selection: body.selection,
  });

  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      try {
        for await (const event of chat.stream(prepared, abort.signal)) send(event);
      } catch (error) {
        logger.error("chat.stream_failed", { error });
        send({ type: "error", code: "internal_error", message: "Something went wrong while answering. Please try again." });
      } finally {
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
});
