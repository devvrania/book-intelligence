import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AIProviderError } from "@/lib/ai";
import type { Database } from "@/lib/db/client";
import { processingJobs } from "@/lib/db/schema";

import { buildBookPdf } from "../../seed/pdf-builder";
import { createTestDb } from "../helpers/db";
import { createTestServices } from "../helpers/factories";

const paragraph = (topic: string, i: number) =>
  `Paragraph ${i} considers ${topic}. A careful reader notices how ${topic} shapes every decision, and why patience with ${topic} matters more than speed.`;

async function samplePdf() {
  return buildBookPdf({
    title: "Lessons of the Harbour",
    author: "Test Author",
    chapters: [
      { heading: "Chapter I. Tides", paragraphs: Array.from({ length: 25 }, (_, i) => paragraph("the tides", i + 1)) },
      { heading: "Chapter II. Lighthouses", paragraphs: Array.from({ length: 25 }, (_, i) => paragraph("the lighthouse", i + 1)) },
    ],
  });
}

describe("ingestion pipeline (upload → background job → READY)", () => {
  let db: Database;
  let close: () => Promise<void>;
  let ctx: ReturnType<typeof createTestServices>;

  beforeAll(async () => {
    const test = await createTestDb();
    db = test.db;
    close = test.close;
    ctx = createTestServices(db);
  });
  afterAll(async () => close());

  const worker = () => ctx.services.createWorker({ retryBaseDelayMs: 0, pollIntervalMs: 50 });

  it("processes an uploaded PDF in the background", async () => {
    const pdf = await samplePdf();
    const created = await ctx.services.books.create({ filename: "harbour.pdf", fileSize: pdf.byteLength });
    expect(created.status).toBe("UPLOADING");

    const uploaded = await ctx.services.books.upload(created.id, pdf);
    expect(uploaded.status).toBe("PROCESSING");
    expect(uploaded.processingStage).toBe("QUEUED");

    expect(await worker().drain()).toBe(1);

    const book = await ctx.services.books.get(created.id);
    expect(book.status).toBe("READY");
    expect(book.processingStage).toBe("COMPLETE");
    expect(book.title).toBe("Lessons of the Harbour"); // detected title replaced the filename placeholder
    expect(book.author).toBe("Test Author");
    expect(book.chapters.map((c) => c.title)).toEqual(["Tides", "Lighthouses"]);
    expect(book.chunkCount).toBeGreaterThan(1);
    expect(book.embeddingModel).toBe("fake:fake-embedding-1536");
    expect(book.insights?.suggestedQuestions.length).toBeGreaterThan(3);

    const counts = await ctx.services.repositories.documents.countChunks(created.id);
    expect(counts.embedded).toBe(counts.total);
  });

  it("marks a corrupted PDF as failed without retrying", async () => {
    const broken = new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf");
    const created = await ctx.services.books.create({ filename: "broken.pdf", fileSize: broken.byteLength });
    await ctx.services.books.upload(created.id, broken);
    await worker().drain();

    const book = await ctx.services.books.get(created.id);
    expect(book.status).toBe("FAILED");
    expect(book.processingError).toMatch(/valid PDF|corrupted/);
    const [job] = await db.select().from(processingJobs).where(eq(processingJobs.bookId, created.id));
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(1);
  });

  it("retries transient AI failures, then fails with a friendly message", async () => {
    ctx.embeddings.failWith = new AIProviderError("rate_limit");
    const pdf = await samplePdf();
    const created = await ctx.services.books.create({ filename: "retry.pdf", fileSize: pdf.byteLength });
    await ctx.services.books.upload(created.id, pdf);
    await worker().drain();

    const [job] = await db.select().from(processingJobs).where(eq(processingJobs.bookId, created.id));
    expect(job.attempts).toBe(3);
    expect(job.status).toBe("failed");
    const failed = await ctx.services.books.get(created.id);
    expect(failed.status).toBe("FAILED");
    expect(failed.processingError).toMatch(/busy/i);

    // Work done before the failure is checkpointed: a resumed run skips extraction and chunking.
    ctx.embeddings.failWith = null;
    const pagesBefore = await ctx.services.repositories.documents.countPages(created.id);
    expect(pagesBefore).toBeGreaterThan(0);
    await ctx.services.ingestion.run({ bookId: created.id }, { jobId: "resume", attempt: 1, maxAttempts: 1, isFinalAttempt: true });
    const resumed = await ctx.services.books.get(created.id);
    expect(resumed.status).toBe("READY");
  });

  it("validates uploads before storing them", async () => {
    await expect(ctx.services.books.create({ filename: "notes.txt", fileSize: 10 })).rejects.toMatchObject({ status: 415 });
    await expect(ctx.services.books.create({ filename: "huge.pdf", fileSize: 10 * 1024 ** 3 })).rejects.toMatchObject({ status: 413 });
    const created = await ctx.services.books.create({ filename: "fake.pdf", fileSize: 5 });
    await expect(ctx.services.books.upload(created.id, new TextEncoder().encode("hello"))).rejects.toMatchObject({ status: 415 });
    expect(ctx.storage.objects.size).toBe(3); // only the three real uploads above were stored
  });

  it("deduplicates processing jobs for the same book", async () => {
    const pdf = await samplePdf();
    const created = await ctx.services.books.create({ filename: "dedupe.pdf", fileSize: pdf.byteLength });
    await ctx.services.books.upload(created.id, pdf);
    const second = await ctx.services.queue.enqueue("ingest_book", { bookId: created.id }, { bookId: created.id });
    expect(second.deduplicated).toBe(true);
    await worker().drain();
  });
});
