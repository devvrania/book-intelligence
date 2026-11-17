import { getServices } from "@/server/container";
import { noStore, parseId, withLibrary } from "@/server/http/handler";
import { readVisitorId, renewVisitorCookie } from "@/server/http/visitor";

/** GET /api/conversations/:id/messages — full history with sources (only for the visitor who started it). */
export const GET = withLibrary(async (request, context: RouteContext<"/api/conversations/[id]/messages">) => {
  const id = parseId((await context.params).id, "Conversation");
  const result = await getServices().conversations.messages(id, readVisitorId(request));
  // reopening a chat counts as a visit: renew the visitor cookie for another year
  const renewed = renewVisitorCookie(request);
  return Response.json(result, { headers: renewed ? { ...noStore, "Set-Cookie": renewed } : noStore });
});
