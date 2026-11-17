import { describe, expect, it } from "vitest";

import { DocumentProcessor } from "@/lib/documents/document-processor";
import { cleanAuthor, detectStructure } from "@/lib/documents/structure-detector";
import { parseChapterHeading } from "@/lib/documents/structure-patterns";
import { cleanDocument } from "@/lib/documents/text-cleaner";
import { DocumentError, type ExtractedDocument, type PdfTextLine } from "@/lib/documents/types";
import { romanToNumber, splitSentences } from "@/lib/documents/text-utils";

import { buildBookPdf } from "../../seed/pdf-builder";

/** Build a synthetic extracted page: lines laid out top-down at 15pt leading. */
function page(pageNumber: number, lines: (Partial<PdfTextLine> & { text: string })[], height = 648) {
  let top = 80;
  return {
    pageNumber,
    width: 432,
    height,
    lines: lines.map((line) => {
      const placed = { x: 54, width: 320, fontSize: 11, top, ...line };
      top = (line.top ?? top) + 15;
      return placed;
    }),
  };
}

function doc(pages: ExtractedDocument["pages"], info: ExtractedDocument["info"] = {}): ExtractedDocument {
  return { pageCount: pages.length, info, outline: [], pageLabels: null, pages };
}

const BODY = "The quick brown fox jumps over the lazy dog while the river runs steadily toward the distant sea.";

describe("text cleaning", () => {
  it("removes running headers, footers and page numbers", () => {
    const pages = Array.from({ length: 6 }, (_, i) =>
      page(i + 1, [
        { text: "A Field Guide to Rivers", top: 36, fontSize: 8 },
        { text: BODY, top: 90 },
        { text: `${i + 1}`, top: 615, fontSize: 9 },
      ]),
    );
    const cleaned = cleanDocument(doc(pages));
    for (const p of cleaned.pages) {
      expect(p.blocks.map((b) => b.text)).toEqual([BODY]);
    }
    expect(cleaned.stats.removedPageNumbers).toBe(6);
  });

  it("repairs hyphenated line breaks and rebuilds paragraphs from indentation", () => {
    const pages = [
      page(1, [
        { text: "The orchard was quiet in the early morning and the gar-", width: 320 },
        { text: "deners had not yet arrived with their baskets and ladders.", width: 300 },
        { text: "A second paragraph begins here with a clear indent.", x: 70, width: 300 },
        { text: "It continues on the next line of the same paragraph.", width: 280 },
      ]),
    ];
    const blocks = cleanDocument(doc(pages)).pages[0].blocks;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("The orchard was quiet in the early morning and the gardeners had not yet arrived with their baskets and ladders.");
    expect(blocks[1].text).toBe("A second paragraph begins here with a clear indent. It continues on the next line of the same paragraph.");
  });

  it("detects headings from font size", () => {
    const pages = [page(1, [{ text: "CHAPTER IV", fontSize: 16 }, { text: "Tactical Dispositions", fontSize: 14 }, { text: BODY, top: 140 }])];
    const blocks = cleanDocument(doc(pages)).pages[0].blocks;
    // Label and title stay separate headings; the structure detector pairs them.
    expect(blocks[0]).toMatchObject({ type: "heading", text: "CHAPTER IV" });
    expect(blocks[1]).toMatchObject({ type: "heading", text: "Tactical Dispositions" });
    expect(blocks[2]).toMatchObject({ type: "paragraph", text: BODY });
  });
});

describe("structure detection", () => {
  it("parses chapter headings in many styles", () => {
    expect(parseChapterHeading("Chapter IV. Tactical Dispositions")).toMatchObject({ label: "Chapter IV", number: 4, rest: "Tactical Dispositions" });
    expect(parseChapterHeading("CHAPTER 12: The Garden")).toMatchObject({ number: 12, rest: "The Garden" });
    expect(parseChapterHeading("Part Two")).toMatchObject({ keyword: "part", number: 2 });
    expect(parseChapterHeading("Chapter One Morning")).toMatchObject({ number: 1, rest: "Morning" });
    expect(parseChapterHeading("Part of the problem was the weather.")).toBeNull();
    expect(romanToNumber("xiv")).toBe(14);
    expect(romanToNumber("mix")).toBe(1009);
  });

  it("finds chapters, titles and sections and ignores a table of contents", () => {
    const pages = [
      page(1, [{ text: "The River Book", fontSize: 24 }, { text: "by Ada Lovelace", top: 140 }]),
      page(2, [
        { text: "Contents", fontSize: 16 },
        { text: "Chapter 1 Sources", top: 120 },
        { text: "Chapter 2 Deltas" },
        { text: "Chapter 3 Floods" },
      ]),
      page(3, [{ text: "Chapter 1", fontSize: 16 }, { text: "Sources", fontSize: 14 }, { text: BODY, top: 160 }]),
      page(4, [{ text: "Mountain Springs", fontSize: 13 }, { text: BODY, top: 120 }]),
      page(5, [{ text: "Chapter 2", fontSize: 16 }, { text: "Deltas", fontSize: 14 }, { text: BODY, top: 160 }]),
      page(6, [{ text: "Chapter 3", fontSize: 16 }, { text: "Floods", fontSize: 14 }, { text: BODY, top: 160 }]),
    ];
    const extracted = doc(pages);
    const structure = detectStructure(cleanDocument(extracted), extracted, { filename: "rivers.pdf" });

    expect(structure.title).toBe("The River Book");
    expect(structure.author).toBe("Ada Lovelace");
    expect(structure.chapters.map((c) => [c.label, c.title, c.startPage])).toEqual([
      ["Chapter 1", "Sources", 3],
      ["Chapter 2", "Deltas", 5],
      ["Chapter 3", "Floods", 6],
    ]);
    expect(structure.chapters[0].endPage).toBe(4);
    const sectionBlock = structure.pages[3].blocks.find((b) => b.type === "paragraph");
    expect(sectionBlock?.sectionTitle).toBe("Mountain Springs");
    expect(structure.pages[3].chapterNumber).toBe(1);
  });

  it("prefers PDF metadata for title and author", () => {
    const extracted = doc([page(1, [{ text: BODY }])], { title: "Metadata Title", author: "Metadata Author" });
    const structure = detectStructure(cleanDocument(extracted), extracted);
    expect(structure.title).toBe("Metadata Title");
    expect(structure.author).toBe("Metadata Author");
  });

  it("strips catalogue codes that publishers pack into the author field", () => {
    const extracted = doc([page(1, [{ text: BODY }])], { author: "Lewis Carroll; BkV0000010; BksIr0000001; ISBN<n/a>;" });
    expect(detectStructure(cleanDocument(extracted), extracted).author).toBe("Lewis Carroll");
  });

  it("finds the author on a title page when the metadata has none", () => {
    const gutenberg = doc([page(1, [{ text: "Title: The Adventures of Sherlock Holmes" }, { text: "Author: Arthur Conan Doyle" }, { text: BODY }])]);
    expect(detectStructure(cleanDocument(gutenberg), gutenberg).author).toBe("Arthur Conan Doyle");

    const split = doc([page(1, [{ text: "The Adventures of Sherlock Holmes", fontSize: 20 }, { text: "by" }, { text: "Arthur Conan Doyle" }, { text: BODY }])]);
    expect(detectStructure(cleanDocument(split), split).author).toBe("Arthur Conan Doyle");
  });
});

describe("cleanAuthor", () => {
  it("keeps names and drops codes, ids and links", () => {
    expect(cleanAuthor("Lewis Carroll; BkV0000010; BksIr0000001; ISBN<n/a>;")).toBe("Lewis Carroll");
    expect(cleanAuthor("Jane Austen")).toBe("Jane Austen");
    expect(cleanAuthor("Neil Gaiman; Terry Pratchett")).toBe("Neil Gaiman, Terry Pratchett");
    expect(cleanAuthor("J.K. Rowling")).toBe("J.K. Rowling");
    expect(cleanAuthor("Mary Shelley; Mary Shelley")).toBe("Mary Shelley");
    expect(cleanAuthor("https://example.com; 978-0-14-143951-8")).toBeNull();
    expect(cleanAuthor("")).toBeNull();
    expect(cleanAuthor(null)).toBeNull();
  });
});

describe("sentence splitting", () => {
  it("does not split on honorifics or initials", () => {
    expect(splitSentences("Mr. Darcy bowed. Elizabeth smiled. J. R. Tolkien wrote books.")).toEqual([
      "Mr. Darcy bowed.",
      "Elizabeth smiled.",
      "J. R. Tolkien wrote books.",
    ]);
  });
});

describe("DocumentProcessor (real PDF)", () => {
  it("extracts, cleans and structures a generated book PDF", async () => {
    const pdf = await buildBookPdf({
      title: "Notes on Rivers",
      author: "Test Author",
      chapters: [
        { heading: "Chapter I. Sources", paragraphs: Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}. ${BODY} ${BODY}`) },
        { heading: "Chapter II. Deltas", paragraphs: Array.from({ length: 30 }, (_, i) => `Delta paragraph ${i + 1}. ${BODY}`) },
      ],
    });
    const structure = await new DocumentProcessor().process(pdf, { filename: "rivers.pdf" });

    expect(structure.title).toBe("Notes on Rivers");
    expect(structure.chapters.map((c) => c.title)).toEqual(["Sources", "Deltas"]);
    const allText = structure.pages.map((p) => p.content).join("\n");
    // Running headers and page numbers are gone; body text survives.
    expect(allText).not.toMatch(/^\d+$/m);
    expect(allText.match(/Notes on Rivers/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(allText).toContain("Paragraph 30.");
    expect(allText).toContain("Delta paragraph 30.");
  });

  it("rejects files that are not PDFs", async () => {
    await expect(new DocumentProcessor().process(new TextEncoder().encode("hello"))).rejects.toBeInstanceOf(DocumentError);
  });

  it("rejects corrupted PDFs", async () => {
    const corrupted = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage");
    await expect(new DocumentProcessor().process(corrupted)).rejects.toMatchObject({ kind: "invalid_pdf" });
  });
});
