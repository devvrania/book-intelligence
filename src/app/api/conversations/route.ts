import { z } from "zod";

import { getServices } from "@/server/container";
import { noStore, parseWith, withLibrary } from "@/server/http/handler";
import { readVisitorId } from "@/server/http/visitor";

const listQuery = z.object({ bookId: z.uuid() });

/** GET /api/conversations?bookId=… — this visitor's conversations about one book, newest first. */
export const GET = withLibrary(async (request) => {
  const { bookId } = parseWith(listQuery, Object.fromEntries(request.nextUrl.searchParams));
  const conversations = await getServices().conversations.list(bookId, readVisitorId(request));
  return Response.json({ conversations }, { headers: noStore });
});
