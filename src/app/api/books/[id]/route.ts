import { z } from "zod";

import { getServices } from "@/server/container";
import { assertChangesAllowed, noStore, parseId, parseJson, withLibrary } from "@/server/http/handler";

const updateBody = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    author: z.string().trim().max(300).nullable().optional(),
    description: z.string().trim().max(4000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

export const GET = withLibrary(async (_request, context: RouteContext<"/api/books/[id]">) => {
  const id = parseId((await context.params).id, "Book");
  const book = await getServices().books.get(id);
  return Response.json(book, { headers: noStore });
});

export const PATCH = withLibrary(async (request, context: RouteContext<"/api/books/[id]">) => {
  assertChangesAllowed();
  const id = parseId((await context.params).id, "Book");
  const body = await parseJson(request, updateBody);
  const book = await getServices().books.update(id, {
    ...body,
    author: body.author === "" ? null : body.author,
    description: body.description === "" ? null : body.description,
  });
  return Response.json(book);
});

export const DELETE = withLibrary(async (_request, context: RouteContext<"/api/books/[id]">) => {
  assertChangesAllowed();
  const id = parseId((await context.params).id, "Book");
  await getServices().books.delete(id);
  return new Response(null, { status: 204 });
});
