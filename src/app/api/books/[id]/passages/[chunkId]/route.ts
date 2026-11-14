import { getServices } from "@/server/container";
import { noStore, parseId, withLibrary } from "@/server/http/handler";

/** GET /api/books/:id/passages/:chunkId — the full passage behind a citation. */
export const GET = withLibrary(async (_request, context: RouteContext<"/api/books/[id]/passages/[chunkId]">) => {
  const params = await context.params;
  const id = parseId(params.id, "Book");
  const chunkId = parseId(params.chunkId, "Passage");
  const passage = await getServices().books.getPassage(id, chunkId);
  return Response.json(passage, { headers: noStore });
});
