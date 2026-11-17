import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// `server-only` throws outside a React Server Components bundle; these helpers are plain functions.
vi.mock("server-only", () => ({}));

const { ensureVisitorId, renewVisitorCookie, VISITOR_COOKIE } = await import("@/server/http/visitor");

const ID = "3f9c1a2b-4d5e-4f60-8a71-b2c3d4e5f607";
const ONE_YEAR = `Max-Age=${365 * 24 * 60 * 60}`;
const request = (url: string, cookie?: string) =>
  new NextRequest(url, { headers: cookie ? { cookie: `${VISITOR_COOKIE}=${cookie}` } : {} });

describe("visitor cookie", () => {
  it("mints an id for a browser without one", () => {
    const { visitorId, setCookie } = ensureVisitorId(request("http://localhost/api/books/x/chat"));
    expect(visitorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setCookie).toContain(`${VISITOR_COOKIE}=${visitorId}`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
  });

  it("keeps an existing id and renews it for another year on every question (rolling expiry)", () => {
    const { visitorId, setCookie } = ensureVisitorId(request("http://localhost/api/books/x/chat", ID));
    expect(visitorId).toBe(ID);
    expect(setCookie).toContain(`${VISITOR_COOKIE}=${ID}`);
    expect(setCookie).toContain(ONE_YEAR);
  });

  it("renews the cookie when a chat is reopened, but never mints one there", () => {
    expect(renewVisitorCookie(request("http://localhost/api/conversations/x/messages", ID))).toContain(ONE_YEAR);
    expect(renewVisitorCookie(request("http://localhost/api/conversations/x/messages"))).toBeNull();
  });

  it("treats a tampered value as no id", () => {
    const { visitorId } = ensureVisitorId(request("http://localhost/api/books/x/chat", "not-a-uuid"));
    expect(visitorId).not.toBe("not-a-uuid");
    expect(renewVisitorCookie(request("http://localhost/api/conversations/x/messages", "not-a-uuid"))).toBeNull();
  });

  it("is Secure over HTTPS, including behind a proxy", () => {
    expect(ensureVisitorId(request("https://books.example.com/api/books/x/chat")).setCookie).toContain("Secure");
    const proxied = new NextRequest("http://internal/api/books/x/chat", { headers: { "x-forwarded-proto": "https" } });
    expect(ensureVisitorId(proxied).setCookie).toContain("Secure");
    expect(ensureVisitorId(request("http://localhost/api/books/x/chat")).setCookie).not.toContain("Secure");
  });
});
