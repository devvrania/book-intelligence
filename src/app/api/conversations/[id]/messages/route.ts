import { getServices } from "@/server/container";
import { noStore, parseId, withLibrary } from "@/server/http/handler";

/** GET /api/conversations/:id/messages — full history with sources. */
export const GET = withLibrary(async (_request, context: RouteContext<"/api/conversations/[id]/messages">) => {
  const id = parseId((await context.params).id, "Conversation");
  const result = await getServices().conversations.messages(id);
  return Response.json(result, { headers: noStore });
});
