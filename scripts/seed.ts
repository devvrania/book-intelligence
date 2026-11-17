import "./load-env";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { checkAI, formatHealthReport } from "@/lib/ai/health";
import { closeDb } from "@/lib/db/client";
import { books } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { NoopRateLimiter } from "@/lib/rate-limit";
import { createServices } from "@/server/container";

import { buildBookPdf, parseSeedMarkdown } from "../seed/pdf-builder";

/**
 * Development seed: public-domain books in the shared library, put through
 * the *real* ingestion pipeline (PDF → extraction → chunking → embeddings).
 *
 *   npm run db:seed
 */

async function main() {
  const services = createServices({ rateLimiter: new NoopRateLimiter() });
  const { db } = services;

  // Seeding generates embeddings, so the AI provider (OpenAI or local Ollama) must work.
  const health = await checkAI(services.env, services.ai);
  if (!health.ok) {
    console.error(`\n✖ The AI provider isn't ready, so the demo books can't be processed.\n\n${formatHealthReport(health)}\n`);
    process.exitCode = 1;
    return;
  }

  const seedDir = path.join(process.cwd(), "seed", "books");
  const files = (await readdir(seedDir)).filter((file) => file.endsWith(".md")).sort();

  const pending: string[] = [];
  for (const file of files) {
    const book = parseSeedMarkdown(await readFile(path.join(seedDir, file), "utf8"));
    const [existing] = await db
      .select({ id: books.id, status: books.status })
      .from(books)
      .where(eq(books.title, book.title))
      .limit(1);

    if (existing?.status === "READY") {
      logger.info("seed.book_exists", { title: book.title });
      continue;
    }
    if (existing) await services.books.delete(existing.id);

    const pdf = await buildBookPdf(book);
    const filename = `${file.replace(/\.md$/, "")}.pdf`;
    const created = await services.books.create({ filename, fileSize: pdf.byteLength });
    await services.books.upload(created.id, pdf);
    pending.push(created.id);
    logger.info("seed.book_uploaded", { title: book.title, kb: Math.round(pdf.byteLength / 1024) });
  }

  if (pending.length > 0) {
    // Process inline; an embedded dev-server worker may also pick jobs up, which is fine.
    const worker = services.createWorker({ pollIntervalMs: 500 });
    await worker.drain();
    await waitUntilProcessed(services, pending);
  }

  console.log(`
✔ Demo library ready.

  Open ${services.env.NEXT_PUBLIC_APP_URL}
`);
}

async function waitUntilProcessed(services: ReturnType<typeof createServices>, bookIds: string[]) {
  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    const statuses = await Promise.all(bookIds.map((id) => services.books.getSummary(id)));
    const failed = statuses.filter((book) => book.status === "FAILED");
    for (const book of failed) logger.error("seed.book_failed", { title: book.title, error: book.processingError });
    if (statuses.every((book) => book.status === "READY" || book.status === "FAILED")) return;
    if (Date.now() > deadline) throw new Error("Timed out waiting for seed books to process");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

main()
  .catch((error) => {
    logger.error("seed.failed", { error });
    process.exitCode = 1;
  })
  .finally(() => closeDb());
