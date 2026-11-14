import { isChapterHeading } from "./structure-patterns";
import type { CleanBlock, CleanDocument, CleanPage, ExtractedDocument, ExtractedPage, PdfTextLine } from "./types";

/**
 * Turn positioned lines into clean, structured blocks per page:
 *  - remove running headers/footers and page numbers
 *  - rebuild paragraphs from line geometry (gaps, indentation, short lines)
 *  - repair hyphenated line breaks and wrapped lines
 *  - flag paragraphs that continue across a page break
 *
 * It only removes layout artifacts; it never rewrites the author's words.
 */

/** Fraction of the page height treated as header/footer zone. */
const EDGE_ZONE = 0.1;
const MAX_EDGE_LINES = 3;

const PAGE_NUMBER_RE =
  /^(?:[-–—]\s*)?(?:page\s+)?(?:\d{1,4}|[ivxlcdm]{1,7})(?:\s*(?:of|\/)\s*\d{1,4})?(?:\s*[-–—])?$/i;
const SCENE_BREAK_RE = /^(?:[*•·⁂§#~✦❧]\s*){1,7}$/;
const SENTENCE_END_RE = /[.!?…:;"”’)\]]$/;

export function cleanDocument(doc: ExtractedDocument): CleanDocument {
  const bodyFontSize = estimateBodyFontSize(doc.pages);
  const { removable, stats } = findBoilerplate(doc.pages, bodyFontSize, doc.info.title);

  const pages: CleanPage[] = doc.pages.map((page) => {
    const lines = page.lines.filter((_, index) => !removable.has(`${page.pageNumber}:${index}`));
    return {
      pageNumber: page.pageNumber,
      pageLabel: doc.pageLabels?.[page.pageNumber - 1] ?? null,
      blocks: buildBlocks(lines, bodyFontSize),
    };
  });

  markContinuations(pages, usesIndentedParagraphs(pages));
  for (const page of pages) for (const block of page.blocks) delete block.indented;
  return { pages, bodyFontSize, stats };
}

/* ---------------------------- Body font size ------------------------------ */

function estimateBodyFontSize(pages: ExtractedPage[]): number {
  const weights = new Map<number, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const size = Math.round(line.fontSize * 2) / 2;
      weights.set(size, (weights.get(size) ?? 0) + line.text.length);
    }
  }
  let best = 11;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

/* ------------------------- Headers, footers, numbers ---------------------- */

function matchKey(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function signature(text: string) {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\b[ivxlcdm]{1,7}\b/g, "#")
    .replace(/[^\p{L}#]+/gu, " ")
    .trim();
}

function edgeLineIndexes(page: ExtractedPage): number[] {
  const indexes = new Set<number>();
  const top = page.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.top <= page.height * EDGE_ZONE)
    .slice(0, MAX_EDGE_LINES);
  const bottom = page.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.top >= page.height * (1 - EDGE_ZONE))
    .slice(-MAX_EDGE_LINES);
  for (const { index } of [...top, ...bottom]) indexes.add(index);
  return [...indexes];
}

function findBoilerplate(pages: ExtractedPage[], bodyFontSize: number, documentTitle?: string) {
  const removable = new Set<string>();
  const stats = { removedBoilerplateLines: 0, removedPageNumbers: 0 };

  // Running headers usually repeat the book title or the current chapter's
  // heading in small type, so remember every large-type line in the book.
  const headingKeys = new Set<string>();
  if (documentTitle) headingKeys.add(matchKey(documentTitle));
  for (const page of pages) {
    for (const line of page.lines) {
      if (line.fontSize >= bodyFontSize * 1.18 && line.text.length <= 120) headingKeys.add(matchKey(line.text));
    }
  }

  // Count, per signature, the pages on which it appears in the edge zone.
  const occurrences = new Map<string, number[]>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const index of edgeLineIndexes(page)) {
      const sig = signature(page.lines[index].text);
      if (!sig || sig === "#" || seen.has(sig)) continue;
      seen.add(sig);
      occurrences.set(sig, [...(occurrences.get(sig) ?? []), page.pageNumber]);
    }
  }

  const isRepeated = (sig: string, large: boolean, small: boolean) => {
    const pagesWithSig = occurrences.get(sig);
    if (!pagesWithSig || pagesWithSig.length < 3) return false;
    const span = pagesWithSig[pagesWithSig.length - 1] - pagesWithSig[0] + 1;
    const density = pagesWithSig.length / span;
    // Running headers alternate (odd/even pages) and skip chapter openings, so
    // densities well under 50% are typical. Large text (likely real headings)
    // must repeat far more to be treated as boilerplate.
    if (large) return density >= 0.6 && pagesWithSig.length >= Math.max(3, pages.length * 0.3);
    return density >= (small ? 0.25 : 0.4);
  };

  for (const page of pages) {
    for (const index of edgeLineIndexes(page)) {
      const line = page.lines[index];
      if (PAGE_NUMBER_RE.test(line.text)) {
        removable.add(`${page.pageNumber}:${index}`);
        stats.removedPageNumbers++;
        continue;
      }
      if (line.fontSize > bodyFontSize * 1.1 && isChapterHeading(line.text)) continue;
      const sig = signature(line.text);
      const large = line.fontSize >= bodyFontSize * 1.25;
      const small = line.fontSize <= bodyFontSize * 0.92;
      const echoesHeading = line.fontSize <= bodyFontSize * 1.05 && headingKeys.has(matchKey(line.text));
      if ((sig && isRepeated(sig, large, small)) || echoesHeading) {
        removable.add(`${page.pageNumber}:${index}`);
        stats.removedBoilerplateLines++;
      }
    }
  }

  return { removable, stats };
}

/* ---------------------------- Paragraph building -------------------------- */

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function isHeadingLine(line: PdfTextLine, body: number, gapBefore: number, gapAfter: number, lineGap: number) {
  const words = line.text.split(/\s+/).length;
  if (line.text.length > 140 || words > 18) return false;
  if (line.fontSize >= body * 1.18) return true;
  // Body-size "CHAPTER IV" style headings set apart by whitespace.
  const isolated = gapBefore > lineGap * 1.6 && gapAfter > lineGap * 1.4;
  if (isolated && line.text.length <= 80 && isChapterHeading(line.text)) return true;
  return false;
}

function joinLine(paragraph: string, next: string): string {
  // Repair words hyphenated across a line break: "exam-" + "ple" → "example".
  if (/[\p{L}]-$/u.test(paragraph) && /^[\p{Ll}]/u.test(next)) {
    return paragraph.slice(0, -1) + next;
  }
  return `${paragraph} ${next}`;
}

function buildBlocks(lines: PdfTextLine[], body: number): CleanBlock[] {
  if (lines.length === 0) return [];

  const bodyLines = lines.filter((line) => Math.abs(line.fontSize - body) <= Math.max(1, body * 0.08));
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i].top - lines[i - 1].top;
    if (gap > 0 && Math.abs(lines[i].fontSize - body) < 1 && Math.abs(lines[i - 1].fontSize - body) < 1) gaps.push(gap);
  }
  const lineGap = median(gaps) ?? body * 1.35;
  const leftMargin = percentile(bodyLines.map((line) => line.x), 0.1) ?? Math.min(...lines.map((line) => line.x));
  const fullWidth = percentile(bodyLines.map((line) => line.width), 0.9) ?? Math.max(...lines.map((line) => line.width));

  const blocks: CleanBlock[] = [];
  let paragraph: { text: string; last: PdfTextLine; indented: boolean } | null = null;
  const isIndented = (line: PdfTextLine) => line.x - leftMargin > body * 0.8;

  const flushParagraph = () => {
    if (!paragraph) return;
    const text = paragraph.text.trim();
    if (text) {
      const type = SCENE_BREAK_RE.test(text) ? "break" : "paragraph";
      const previous = blocks[blocks.length - 1];
      // Drop duplicated extraction artifacts (the same paragraph emitted twice in a row).
      if (!(previous && previous.type === type && previous.text === text)) {
        blocks.push({ type, text, fontSize: body, indented: paragraph.indented });
      }
    }
    paragraph = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = lines[i - 1];
    const next = lines[i + 1];
    const gapBefore = prev ? line.top - prev.top : Number.POSITIVE_INFINITY;
    const gapAfter = next ? next.top - line.top : Number.POSITIVE_INFINITY;

    if (isHeadingLine(line, body, gapBefore, gapAfter, lineGap)) {
      flushParagraph();
      const previous = blocks[blocks.length - 1];
      const continuesHeading =
        previous?.type === "heading" &&
        Math.abs(previous.fontSize - line.fontSize) <= previous.fontSize * 0.12 &&
        gapBefore <= Math.max(previous.fontSize, line.fontSize) * 1.9;
      if (continuesHeading) previous.text = `${previous.text} ${line.text}`;
      else blocks.push({ type: "heading", text: line.text, fontSize: line.fontSize });
      continue;
    }

    if (!paragraph) {
      paragraph = { text: line.text, last: line, indented: isIndented(line) };
      continue;
    }

    const last: PdfTextLine = paragraph.last;
    const bigGap = gapBefore > lineGap * 1.45;
    const indented = line.x - last.x > body * 0.8 && line.x - leftMargin > body * 0.8;
    const lastWasShort = last.width < fullWidth * 0.72 && SENTENCE_END_RE.test(last.text);
    const fontChanged = Math.abs(line.fontSize - last.fontSize) > body * 0.15;
    // A line starting with a chapter label ("Chapter 2 …") never continues a paragraph (e.g. contents pages).
    const startsChapterLabel = line.text.length <= 100 && isChapterHeading(line.text);

    if (bigGap || indented || lastWasShort || fontChanged || startsChapterLabel) {
      flushParagraph();
      paragraph = { text: line.text, last: line, indented: isIndented(line) };
    } else {
      paragraph.text = joinLine(paragraph.text, line.text);
      paragraph.last = line;
    }
  }
  flushParagraph();

  return blocks;
}

/* ------------------------- Cross-page continuations ----------------------- */

/** True when most paragraphs are marked by first-line indentation (typical for books). */
function usesIndentedParagraphs(pages: CleanPage[]): boolean {
  let indented = 0;
  let total = 0;
  for (const page of pages) {
    page.blocks.forEach((block, index) => {
      if (index === 0 || block.type !== "paragraph" || page.blocks[index - 1].type !== "paragraph") return;
      total++;
      if (block.indented) indented++;
    });
  }
  return total >= 10 && indented / total >= 0.5;
}

function markContinuations(pages: CleanPage[], indentStyle: boolean) {
  for (let i = 1; i < pages.length; i++) {
    const previous = pages[i - 1].blocks.at(-1);
    const first = pages[i].blocks[0];
    if (!previous || !first || previous.type !== "paragraph" || first.type !== "paragraph") continue;
    if (indentStyle) {
      // In indented layouts a page that starts flush-left continues the previous paragraph.
      if (!first.indented) first.continuation = true;
      continue;
    }
    const previousOpen = !SENTENCE_END_RE.test(previous.text) || /[\p{L}]-$/u.test(previous.text);
    const startsLower = /^[\p{Ll}]/u.test(first.text);
    if (previousOpen && (startsLower || /,$/.test(previous.text))) first.continuation = true;
  }
}
