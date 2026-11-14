import { getServices } from "@/server/container";
import { noStore, parseId, withLibrary } from "@/server/http/handler";

/** GET /api/books/:id/status — lightweight polling endpoint for processing progress. */
export const GET = withLibrary(async (_request, context: RouteContext<"/api/books/[id]/status">) => {
  const id = parseId((await context.params).id, "Book");
  const book = await getServices().books.getSummary(id);
  return Response.json(book, { headers: noStore });
});
