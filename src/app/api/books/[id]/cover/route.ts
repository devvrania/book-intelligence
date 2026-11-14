import { getServices } from "@/server/container";
import { parseId, withLibrary } from "@/server/http/handler";

/** GET /api/books/:id/cover — cover image rendered from the PDF's first page. */
export const GET = withLibrary(async (_request, context: RouteContext<"/api/books/[id]/cover">) => {
  const id = parseId((await context.params).id, "Book");
  const object = await getServices().books.openCover(id);
  return new Response(object.body, {
    headers: {
      "Content-Type": "image/png",
      ...(object.size ? { "Content-Length": String(object.size) } : {}),
      // URLs are versioned (?v=updatedAt), so the browser may cache privately.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
