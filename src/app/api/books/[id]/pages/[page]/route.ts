import { getServices } from "@/server/container";
import { noStore, parseId, withLibrary } from "@/server/http/handler";
import { NotFoundError } from "@/lib/errors";

/** GET /api/books/:id/pages/:page — one cleaned page (structured blocks) for the reader. */
export const GET = withLibrary(async (_request, context: RouteContext<"/api/books/[id]/pages/[page]">) => {
  const params = await context.params;
  const id = parseId(params.id, "Book");
  const pageNumber = Number.parseInt(params.page, 10);
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new NotFoundError("Page");
  const page = await getServices().books.getPage(id, pageNumber);
  return Response.json(page, { headers: noStore });
});
