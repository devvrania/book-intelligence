import { getEnv } from "@/lib/config/env";
import type { Database } from "@/lib/db/client";
import type { StructuredDocument, StructuredPage } from "@/lib/documents/types";
import { countWords } from "@/lib/documents/text-utils";
import { PostgresJobQueue } from "@/lib/jobs/postgres-queue";
import { NoopRateLimiter } from "@/lib/rate-limit";
import { createServices } from "@/server/container";
import type { PageBlock } from "@/types/domain";

import { fakeAI, FakeChatProvider, MemoryStorage } from "./fakes";

export function createTestServices(db: Database, chat = new FakeChatProvider()) {
  const { ai, embeddings } = fakeAI(chat);
  const storage = new MemoryStorage();
  const services = createServices({
    env: getEnv(),
    db,
    ai,
    storage,
    queue: new PostgresJobQueue(db),
    rateLimiter: new NoopRateLimiter(),
  });
  return { services, embeddings, chat, storage };
}

export interface FixtureChapter {
  label: string;
  title: string;
  paragraphs: string[];
}

/** Build a structured document directly (no PDF): each chapter starts a page, 3 paragraphs per page. */
export function buildDocument(title: string, chapters: FixtureChapter[]): StructuredDocument {
  const pages: StructuredPage[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    const chapterNumber = chapterIndex + 1;
    for (let i = 0; i < chapter.paragraphs.length; i += 3) {
      const blocks: PageBlock[] = [];
      if (i === 0) blocks.push({ type: "heading", level: 1, text: `${chapter.label} ${chapter.title}`, chapterNumber, sectionTitle: null });
      for (const text of chapter.paragraphs.slice(i, i + 3)) blocks.push({ type: "paragraph", text, chapterNumber, sectionTitle: null });
      const content = blocks.map((block) => block.text).join("\n\n");
      pages.push({ pageNumber: pages.length + 1, pageLabel: null, chapterNumber, blocks, content, wordCount: countWords(content) });
    }
  });

  const startPages = new Map<number, number>();
  const endPages = new Map<number, number>();
  for (const page of pages) {
    if (!page.chapterNumber) continue;
    if (!startPages.has(page.chapterNumber)) startPages.set(page.chapterNumber, page.pageNumber);
    endPages.set(page.chapterNumber, page.pageNumber);
  }

  return {
    title,
    author: "Test Author",
    description: null,
    pageCount: pages.length,
    wordCount: pages.reduce((sum, page) => sum + page.wordCount, 0),
    chapterSource: "headings",
    chapters: chapters.map((chapter, index) => ({
      chapterNumber: index + 1,
      title: chapter.title,
      label: chapter.label,
      labelNumber: index + 1,
      startPage: startPages.get(index + 1)!,
      endPage: endPages.get(index + 1)!,
    })),
    pages,
  };
}

/**
 * Create a READY book from fixture chapters by storing its structure and
 * running the real ingestion service from the chunking stage onward
 * (the resume path: pages already exist, so extraction is skipped).
 */
export async function createReadyBook(
  services: ReturnType<typeof createServices>,
  title: string,
  chapters: FixtureChapter[],
) {
  const book = await services.repositories.books.create({
    title,
    author: "Test Author",
    status: "PROCESSING",
    fileKey: "books/fixture/original.pdf",
    originalFilename: "fixture.pdf",
  });
  await services.repositories.documents.replaceStructure(book.id, buildDocument(title, chapters));
  await services.ingestion.run({ bookId: book.id }, { jobId: "test", attempt: 1, maxAttempts: 1, isFinalAttempt: true });
  return (await services.repositories.books.findById(book.id))!;
}

/** Distinct, recognisable fixture content. */
export const GARDENING_BOOK: FixtureChapter[] = [
  {
    label: "Chapter 1",
    title: "Soil",
    paragraphs: [
      "Healthy soil is the foundation of every garden. Compost feeds the soil with organic matter and earthworms aerate it.",
      "Clay soil holds water and nutrients but drains slowly, while sandy soil drains quickly and needs frequent watering.",
      "Testing soil acidity tells the gardener whether to add lime or sulfur before planting vegetables.",
    ],
  },
  {
    label: "Chapter 2",
    title: "Roses",
    paragraphs: [
      "Roses need six hours of sunlight and should be pruned in late winter to encourage strong new canes.",
      "Black spot is a fungal disease of roses; remove infected leaves and water at the base of the plant.",
      "Climbing roses can be trained along a trellis, tying the canes horizontally to produce more blooms.",
    ],
  },
  {
    label: "Chapter 3",
    title: "Tomatoes",
    paragraphs: [
      "Tomatoes are heavy feeders and benefit from compost worked into the planting hole.",
      "Stake or cage tomato plants early, and pinch out suckers to direct energy into the fruit.",
      "Blossom end rot on tomatoes is caused by uneven watering and a shortage of calcium.",
    ],
  },
];

export const ASTRONOMY_BOOK: FixtureChapter[] = [
  {
    label: "Chapter 1",
    title: "The Moon",
    paragraphs: [
      "The Moon orbits the Earth every twenty-seven days, and its phases come from the changing angle of sunlight.",
      "Craters on the lunar surface were formed by ancient meteorite impacts preserved in the airless vacuum.",
    ],
  },
  {
    label: "Chapter 2",
    title: "Comets",
    paragraphs: [
      "Comets are icy bodies whose tails always point away from the Sun because of the solar wind.",
      "Halley's comet returns roughly every seventy-six years and was last seen from Earth in 1986.",
    ],
  },
];
