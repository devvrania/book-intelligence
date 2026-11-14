import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { analyzeQuery } from "@/lib/retrieval/query-analyzer";

import { createTestDb } from "../helpers/db";
import { ASTRONOMY_BOOK, createReadyBook, createTestServices, GARDENING_BOOK } from "../helpers/factories";

describe("retrieval (Postgres + pgvector)", () => {
  let close: () => Promise<void>;
  let ctx: ReturnType<typeof createTestServices>;
  let gardenId: string;
  let astronomyId: string;

  beforeAll(async () => {
    const test = await createTestDb();
    close = test.close;
    ctx = createTestServices(test.db);
    gardenId = (await createReadyBook(ctx.services, "The Gardener's Year", GARDENING_BOOK)).id;
    astronomyId = (await createReadyBook(ctx.services, "Night Skies", ASTRONOMY_BOOK)).id;
  });
  afterAll(async () => close());

  it("only ever returns chunks from the requested book", async () => {
    const results = await ctx.services.retrieval.search({ bookId: astronomyId, query: "compost soil roses tomatoes comets moon" });
    expect(results.length).toBeGreaterThan(0);
    const chapterTitles = new Set(results.map((r) => r.chapterTitle));
    expect([...chapterTitles].every((title) => title === "The Moon" || title === "Comets")).toBe(true);
  });

  it("finds passages by meaning (vector similarity)", async () => {
    const [top] = await ctx.services.retrieval.search({ bookId: gardenId, query: "how should I prune roses in winter" });
    expect(top.chapterTitle).toBe("Roses");
    expect(top.semanticScore).toBeGreaterThan(0.2);
    expect(top.matchedBy).toContain("semantic");
  });

  it("finds passages by exact keywords (full-text search)", async () => {
    const results = await ctx.services.retrieval.search({ bookId: gardenId, query: "calcium" });
    const hit = results.find((r) => r.keywordScore > 0);
    expect(hit?.chapterTitle).toBe("Tomatoes");
    expect(hit?.matchedBy).toContain("keyword");
  });

  it("ranks passages matching both meaning and keywords first", async () => {
    const results = await ctx.services.retrieval.search({ bookId: gardenId, query: "black spot fungal disease on roses" });
    expect(results[0].chapterTitle).toBe("Roses");
    expect(results[0].keywordScore).toBeGreaterThan(0);
    // Scores are sorted.
    for (let i = 1; i < results.length; i++) expect(results[i - 1].hybridScore).toBeGreaterThanOrEqual(results[i].hybridScore);
  });

  it("filters by chapter metadata", async () => {
    const chapters = await ctx.services.repositories.documents.listChapters(gardenId);
    const tomatoes = chapters.find((c) => c.title === "Tomatoes")!;
    const results = await ctx.services.retrieval.search({ bookId: gardenId, query: "compost", filters: { chapterIds: [tomatoes.id] } });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.chapterId === tomatoes.id)).toBe(true);
  });

  it("focuses chapter-specific questions on that chapter", async () => {
    const chapters = await ctx.services.repositories.documents.listChapters(gardenId);
    const analysis = analyzeQuery("Summarize chapter 2", chapters);
    const result = await ctx.services.retrieval.retrieve({ bookId: gardenId, query: "Summarize chapter 2", analysis });
    expect(result.strategy).toBe("chapter_focus");
    expect(result.candidates.every((c) => c.chapterTitle === "Roses")).toBe(true);
  });

  it("covers every chapter for book-level questions", async () => {
    const analysis = analyzeQuery("What is this book mainly about?", []);
    const result = await ctx.services.retrieval.retrieve({ bookId: gardenId, query: "What is this book mainly about?", analysis });
    expect(result.strategy).toBe("book_coverage");
    expect(new Set(result.candidates.map((c) => c.chapterTitle))).toEqual(new Set(["Soil", "Roses", "Tomatoes"]));
  });
});
