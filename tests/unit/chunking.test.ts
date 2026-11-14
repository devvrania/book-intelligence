import { describe, expect, it } from "vitest";

import { ChunkingService } from "@/lib/documents/chunking-service";
import { countTokens } from "@/lib/documents/tokenizer";
import type { StructuredPage } from "@/lib/documents/types";

import { buildDocument } from "../helpers/factories";

const config = { targetTokens: 300, maxTokens: 400, minTokens: 80, overlapTokens: 50 };

function paragraph(id: string, sentences = 6) {
  return Array.from(
    { length: sentences },
    (_, i) => `Sentence ${i + 1} of paragraph ${id} explores the ${["river", "harbour", "orchard", "library"][i % 4]} with patient attention.`,
  ).join(" ");
}

function chapter(label: string, title: string, paragraphs: string[]) {
  return { label, title, paragraphs };
}

/** Text of a chunk without the overlap repeated from the previous chunk. */
const ownText = (chunk: { content: string; metadata: { overlapChars?: number } }) =>
  chunk.content.slice(chunk.metadata.overlapChars ?? 0).trim();

describe("ChunkingService", () => {
  const paragraphs = Array.from({ length: 14 }, (_, i) => paragraph(`A${i + 1}`));
  const doc = buildDocument("Fixture", [
    chapter("Chapter 1", "Rivers", paragraphs),
    chapter("Chapter 2", "Harbours", [paragraph("B1"), paragraph("B2"), paragraph("B3")]),
  ]);
  const chunks = new ChunkingService(config).chunk(doc.pages, doc.chapters);

  it("keeps paragraphs intact when they fit", () => {
    for (const chunk of chunks) {
      for (const piece of ownText(chunk).split(/\n\n/)) {
        // Every non-overlap piece is a whole paragraph from the source.
        expect([...paragraphs, paragraph("B1"), paragraph("B2"), paragraph("B3")]).toContain(piece);
      }
    }
  });

  it("respects the maximum chunk size", () => {
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(config.maxTokens);
      expect(chunk.tokenCount).toBe(countTokens(chunk.content));
    }
  });

  it("never mixes chapters in one chunk", () => {
    for (const chunk of chunks) {
      const hasA = /paragraph A\d+/.test(chunk.content);
      const hasB = /paragraph B\d+/.test(chunk.content);
      expect(hasA && hasB).toBe(false);
      expect(chunk.chapterNumber).toBe(hasA ? 1 : 2);
    }
  });

  it("preserves chapter, page and ordering metadata", () => {
    chunks.forEach((chunk, index) => expect(chunk.chunkIndex).toBe(index));
    const second = chunks.find((chunk) => chunk.chapterNumber === 2)!;
    expect(second.metadata.chapterTitle).toBe("Harbours");
    expect(second.metadata.chapterLabel).toBe("Chapter 2");
    for (const chunk of chunks) {
      const pages = doc.pages.filter((page) => page.pageNumber >= chunk.pageStart && page.pageNumber <= chunk.pageEnd);
      expect(pages.length).toBeGreaterThan(0);
      // Each chunk's text really comes from its page range.
      const firstParagraph = ownText(chunk).split(/\n\n/)[0];
      expect(pages.some((page) => page.content.includes(firstParagraph))).toBe(true);
    }
  });

  it("adds sentence-aligned overlap between consecutive chunks of a chapter", () => {
    const sameChapterPairs = chunks.slice(1).filter((chunk, i) => chunk.chapterNumber === chunks[i].chapterNumber);
    expect(sameChapterPairs.length).toBeGreaterThan(0);
    for (const chunk of sameChapterPairs) {
      const previous = chunks[chunk.chunkIndex - 1];
      const overlap = chunk.content.slice(0, chunk.metadata.overlapChars).trim();
      expect(overlap.length).toBeGreaterThan(0);
      expect(previous.content.endsWith(overlap)).toBe(true);
      expect(overlap).toMatch(/^Sentence \d+/); // starts on a sentence boundary
    }
    // No overlap across a chapter boundary.
    const firstOfChapter2 = chunks.find((chunk) => chunk.chapterNumber === 2)!;
    expect(firstOfChapter2.metadata.overlapChars).toBe(0);
  });

  it("splits an oversized paragraph at sentence boundaries", () => {
    const giant = paragraph("G", 80); // far above maxTokens
    const giantDoc = buildDocument("Giant", [chapter("Chapter 1", "Long", [giant])]);
    const pieces = new ChunkingService(config).chunk(giantDoc.pages, giantDoc.chapters);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.tokenCount).toBeLessThanOrEqual(config.maxTokens);
      const own = ownText(piece);
      expect(own).toMatch(/^Sentence \d+/);
      expect(own).toMatch(/attention\.$/);
    }
  });

  it("joins a paragraph that continues across a page break", () => {
    const pages: StructuredPage[] = [
      {
        pageNumber: 1,
        pageLabel: null,
        chapterNumber: null,
        content: "",
        wordCount: 0,
        blocks: [{ type: "paragraph", text: "The storm rolled in over the bay and the fisher-", chapterNumber: null }],
      },
      {
        pageNumber: 2,
        pageLabel: null,
        chapterNumber: null,
        content: "",
        wordCount: 0,
        blocks: [{ type: "paragraph", text: "men hurried their boats into the harbour.", chapterNumber: null, continuation: true }],
      },
    ];
    const [only] = new ChunkingService(config).chunk(pages, []);
    expect(only.content).toBe("The storm rolled in over the bay and the fishermen hurried their boats into the harbour.");
    expect(only.pageStart).toBe(1);
    expect(only.pageEnd).toBe(2);
  });

  it("treats section headings and scene breaks as boundaries", () => {
    const sectioned: StructuredPage[] = [
      {
        pageNumber: 1,
        pageLabel: null,
        chapterNumber: 1,
        content: "",
        wordCount: 0,
        blocks: [
          { type: "heading", level: 1, text: "Chapter 1", chapterNumber: 1 },
          { type: "heading", level: 2, text: "Morning", chapterNumber: 1, sectionTitle: "Morning" },
          ...Array.from({ length: 5 }, (_, i) => ({ type: "paragraph" as const, text: paragraph(`M${i}`), chapterNumber: 1, sectionTitle: "Morning" })),
          { type: "heading", level: 2, text: "Evening", chapterNumber: 1, sectionTitle: "Evening" },
          ...Array.from({ length: 5 }, (_, i) => ({ type: "paragraph" as const, text: paragraph(`E${i}`), chapterNumber: 1, sectionTitle: "Evening" })),
        ],
      },
    ];
    const result = new ChunkingService(config).chunk(sectioned, [{ chapterNumber: 1, title: "Day", label: "Chapter 1" }]);
    for (const chunk of result) {
      const morning = /paragraph M\d/.test(chunk.content);
      const evening = /paragraph E\d/.test(chunk.content);
      expect(morning && evening).toBe(false);
      expect(chunk.sectionTitle).toBe(morning ? "Morning" : "Evening");
    }
  });
});
