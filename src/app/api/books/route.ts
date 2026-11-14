import { z } from "zod";

import { getServices } from "@/server/container";
import { noStore, parseJson, parseWith, withLibrary } from "@/server/http/handler";
import { BOOK_STATUSES } from "@/types/domain";

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(BOOK_STATUSES).optional(),
  sort: z.enum(["recent", "opened", "title"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createBody = z.object({
  filename: z.string().min(1).max(255),
  fileSize: z.number().int().positive(),
});

/** GET /api/books — the shared library (search, filter, sort, paginate). */
export const GET = withLibrary(async (request) => {
  const params = parseWith(listQuery, Object.fromEntries(request.nextUrl.searchParams));
  const result = await getServices().books.list({
    search: params.q,
    status: params.status,
    sort: params.sort,
    limit: params.limit,
    offset: params.offset,
  });
  return Response.json(result, { headers: noStore });
});

/** POST /api/books — create the Book record before the file is uploaded. */
export const POST = withLibrary(async (request) => {
  const body = await parseJson(request, createBody);
  const services = getServices();
  await services.rateLimiter.consume("upload", {
    limit: services.env.RATE_LIMIT_UPLOADS_PER_HOUR,
    windowSeconds: 3600,
  });
  if (services.env.RATE_LIMIT_UPLOADS_PER_DAY) {
    await services.rateLimiter.consume("upload-day", {
      limit: services.env.RATE_LIMIT_UPLOADS_PER_DAY,
      windowSeconds: 86_400,
    });
  }
  const book = await services.books.create(body);
  return Response.json(book, { status: 201 });
});
