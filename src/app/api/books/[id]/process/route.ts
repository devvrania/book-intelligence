import { getServices } from "@/server/container";
import { assertChangesAllowed, parseId, withLibrary } from "@/server/http/handler";

/** POST /api/books/:id/process — (re)queue processing, e.g. after a failure. */
export const POST = withLibrary(async (_request, context: RouteContext<"/api/books/[id]/process">) => {
  const id = parseId((await context.params).id, "Book");
  const services = getServices();
  // Retrying a failed book is always allowed; re-processing a finished one spends AI quota, so it's a "change"
  if ((await services.books.getSummary(id)).status !== "FAILED") assertChangesAllowed();
  const book = await services.books.reprocess(id);
  return Response.json(book, { status: 202 });
});
