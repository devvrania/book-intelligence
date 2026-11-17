import "server-only";

import { randomUUID } from "node:crypto";

import type { NextRequest } from "next/server";

/**
 * Chats are private without accounts: each browser gets a random visitor id in an HttpOnly cookie the first time it
 * asks something, and chats belong to that id. Nothing personal is stored; clearing cookies just starts fresh.
 */
export const VISITOR_COOKIE = "bi_visitor";
const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The visitor id from a cookie value, or null if there isn't a valid one (a tampered value counts as none). */
export function parseVisitorId(value: string | undefined | null): string | null {
  return value && UUID_RE.test(value) ? value.toLowerCase() : null;
}

export function readVisitorId(request: NextRequest): string | null {
  return parseVisitorId(request.cookies.get(VISITOR_COOKIE)?.value);
}

/**
 * This request's visitor id, minting one if the browser doesn't have it yet, plus the Set-Cookie header value to send
 * back. The cookie is re-sent on every question so its year counts from the visitor's LAST visit (a rolling expiry):
 * someone who keeps coming back never loses their chats.
 */
export function ensureVisitorId(request: NextRequest): { visitorId: string; setCookie: string } {
  const visitorId = readVisitorId(request) ?? randomUUID();
  return { visitorId, setCookie: visitorCookie(request, visitorId) };
}

/** Renews an existing visitor's cookie for another year (null when the browser has none: nothing to renew). */
export function renewVisitorCookie(request: NextRequest): string | null {
  const visitorId = readVisitorId(request);
  return visitorId ? visitorCookie(request, visitorId) : null;
}

function visitorCookie(request: NextRequest, visitorId: string) {
  const secure = request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return [
    `${VISITOR_COOKIE}=${visitorId}`,
    "Path=/",
    `Max-Age=${ONE_YEAR_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
