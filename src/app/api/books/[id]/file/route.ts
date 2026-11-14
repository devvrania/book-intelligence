import { getServices } from "@/server/container";
import { parseId, withLibrary } from "@/server/http/handler";

/** GET /api/books/:id/file — the original PDF. */
export const GET = withLibrary(async (request, context: RouteContext<"/api/books/[id]/file">) => {
  const id = parseId((await context.params).id, "Book");
  const { object, filename } = await getServices().books.openFile(id);
  const disposition = request.nextUrl.searchParams.get("download") ? "attachment" : "inline";
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/pdf",
      ...(object.size ? { "Content-Length": String(object.size) } : {}),
      "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
