import "server-only";

import type { NextRequest } from "next/server";
import { z, type ZodType } from "zod";

import { getEnv } from "@/lib/config/env";
import {
  AppError,
  ForbiddenError,
  GENERIC_ERROR_MESSAGE,
  isAppError,
  NotFoundError,
  PayloadTooLargeError,
  type RateLimitError,
  ValidationError,
} from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { ApiErrorBody } from "@/types/api";

type Handler<Ctx> = (request: NextRequest, context: Ctx) => Promise<Response>;

class ForbiddenOriginError extends AppError {
  constructor() {
    super("forbidden_origin", 403, "This request was blocked.");
  }
}

/**
 * Wrap a route handler for the shared library (there are no accounts): rejects mutating requests from other sites
 * (an Origin check, so another page can't upload or delete through a visitor's browser), and returns uniform error
 * responses that never leak internals.
 */
export function withLibrary<Ctx>(handler: Handler<Ctx>) {
  return async (request: NextRequest, context: Ctx): Promise<Response> => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") assertSameOrigin(request);
      return await handler(request, context);
    } catch (error) {
      return errorResponse(error, request);
    }
  };
}

function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return; // non-browser clients
  const allowed = new Set([new URL(getEnv().NEXT_PUBLIC_APP_URL).host, request.headers.get("host")]);
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    throw new ForbiddenOriginError();
  }
  if (!allowed.has(host)) throw new ForbiddenOriginError();
}

/**
 * Renaming and deleting (books and chats) can be switched off for a public deployment, where anyone could otherwise
 * wipe the shared library: NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false. Uploading and asking still work.
 */
export function assertChangesAllowed() {
  if (!getEnv().NEXT_PUBLIC_ALLOW_BOOK_CHANGES) {
    throw new ForbiddenError("Renaming and deleting are turned off in this library.");
  }
}

export function errorResponse(error: unknown, request?: Request): Response {
  const path = request ? new URL(request.url).pathname : undefined;
  if (isAppError(error)) {
    if (error.status >= 500) logger.error("api.error", { path, code: error.code, error });
    else logger.debug("api.client_error", { path, code: error.code, status: error.status });
    const body: ApiErrorBody = {
      error: { code: error.code, message: error.userMessage, ...(error.details ? { details: error.details } : {}) },
    };
    const headers: HeadersInit =
      error.code === "rate_limited" ? { "Retry-After": String((error as RateLimitError).retryAfterSeconds) } : {};
    return Response.json(body, { status: error.status, headers });
  }
  logger.error("api.unhandled_error", { path, error });
  const body: ApiErrorBody = { error: { code: "internal_error", message: GENERIC_ERROR_MESSAGE } };
  return Response.json(body, { status: 500 });
}

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ValidationError("The request body must be valid JSON.");
  }
  return parseWith(schema, body);
}

export function parseWith<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue?.message ?? "Invalid request.", {
      issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}

const uuid = z.uuid();

/** Route ids must be UUIDs; anything else is simply "not found". */
export function parseId(value: string, resource = "Resource"): string {
  if (!uuid.safeParse(value).success) throw new NotFoundError(resource);
  return value;
}

/** Read a request body into memory, refusing to buffer more than `maxBytes`. */
export async function readBodyWithLimit(request: Request, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = () =>
    new PayloadTooLargeError(`This file is too large. The maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw tooLarge();
  if (!request.body) throw new ValidationError("The upload was empty.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export const noStore = { "Cache-Control": "private, no-store" } as const;
