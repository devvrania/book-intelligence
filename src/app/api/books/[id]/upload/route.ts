import { getServices } from "@/server/container";
import { parseId, readBodyWithLimit, withLibrary } from "@/server/http/handler";

/**
 * PUT /api/books/:id/upload — the raw PDF bytes (Content-Type: application/pdf).
 * Stores the file, then enqueues background processing; it never processes
 * the book inside this request.
 */
export const PUT = withLibrary(async (request, context: RouteContext<"/api/books/[id]/upload">) => {
  const id = parseId((await context.params).id, "Book");
  const services = getServices();
  const data = await readBodyWithLimit(request, Math.round(services.env.MAX_UPLOAD_MB * 1024 * 1024));
  const book = await services.books.upload(id, data);
  return Response.json(book, { status: 202 });
});
