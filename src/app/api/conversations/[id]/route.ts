import { z } from "zod";

import { getServices } from "@/server/container";
import { assertChangesAllowed, parseId, parseJson, withLibrary } from "@/server/http/handler";

const renameBody = z.object({ title: z.string().trim().min(1).max(120) });

export const PATCH = withLibrary(async (request, context: RouteContext<"/api/conversations/[id]">) => {
  assertChangesAllowed();
  const id = parseId((await context.params).id, "Conversation");
  const { title } = await parseJson(request, renameBody);
  return Response.json(await getServices().conversations.rename(id, title));
});

export const DELETE = withLibrary(async (_request, context: RouteContext<"/api/conversations/[id]">) => {
  assertChangesAllowed();
  const id = parseId((await context.params).id, "Conversation");
  await getServices().conversations.delete(id);
  return new Response(null, { status: 204 });
});
