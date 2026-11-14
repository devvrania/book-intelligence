import type { PageBlock } from "@/types/domain";

import { FRONT_MATTER_RE, parseChapterHeading } from "./structure-patterns";
import { countWords, smartTitleCase } from "./text-utils";
import type {
  CleanBlock,
  CleanDocument,
  CleanPage,
  DetectedChapter,
  ExtractedDocument,
  StructuredDocument,
  StructuredPage,
} from "./types";

/**
 * Identify title, author, chapters and sections, and annotate every block
 * with the chapter/section it belongs to.
 *
 * Chapter sources, in order of reliability:
 *   1. the PDF outline (bookmarks)
 *   2. explicit headings ("Chapter IV", "Part One", "Letter 3")
 *   3. the largest recurring heading size
 */

interface ChapterMarker {
  pageNumber: number;
  blockIndex: number;
  /** Block index of the chapter heading, if the marker sits on one. */
  headingBlocks: Set<number>;
  title: string;
  label: string | null;
  labelNumber: number | null;
}

export function detectStructure(
  clean: CleanDocument,
  extracted: ExtractedDocument,
  options: { filename?: string | null } = {},
): StructuredDocument {
  const title = detectTitle(clean, extracted) ?? titleFromFilename(options.filename);
  const author = detectAuthor(clean, extracted);

  const { markers, source } = detectChapterMarkers(clean, extracted, title);
  const { pages, chapters } = annotate(clean.pages, markers);

  const wordCount = pages.reduce((sum, page) => sum + page.wordCount, 0);
  const subject = extracted.info.subject?.trim();

  return {
    title,
    author,
    description: subject && subject.length >= 20 && subject.length <= 2000 ? subject : null,
    pageCount: extracted.pageCount,
    wordCount,
    chapterSource: chapters.length > 0 ? source : "none",
    chapters,
    pages,
  };
}

/* ----------------------------- Title & author ----------------------------- */

function meaningfulMetadata(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 200) return null;
  if (/^(untitled|unknown|document|title|microsoft word\b|none|null)/i.test(trimmed)) return null;
  if (/\.(pdf|docx?|txt|indd|tex|rtf|odt|epub)$/i.test(trimmed)) return null;
  if (/^[\w-]+$/.test(trimmed) && /[_\d]/.test(trimmed)) return null; // "scan_00123"
  return trimmed;
}

function detectTitle(clean: CleanDocument, extracted: ExtractedDocument): string | null {
  const fromMetadata = meaningfulMetadata(extracted.info.title);
  if (fromMetadata) return fromMetadata;

  let best: CleanBlock | null = null;
  for (const page of clean.pages.slice(0, 3)) {
    for (const block of page.blocks) {
      if (block.type !== "heading" || block.text.length > 120 || parseChapterHeading(block.text)) continue;
      if (!best || block.fontSize > best.fontSize) best = block;
    }
  }
  return best && best.fontSize >= clean.bodyFontSize * 1.4 ? smartTitleCase(best.text) : null;
}

function detectAuthor(clean: CleanDocument, extracted: ExtractedDocument): string | null {
  const fromMetadata = meaningfulMetadata(extracted.info.author);
  if (fromMetadata && !/^(admin|administrator|user|owner|calibre|adobe|author)\b/i.test(fromMetadata)) {
    return fromMetadata;
  }
  for (const page of clean.pages.slice(0, 3)) {
    for (const block of page.blocks) {
      const match = block.text.match(/^by\s+([\p{L}][\p{L}.'’\s-]{2,80})$/iu);
      if (match) return smartTitleCase(match[1].trim());
    }
  }
  return null;
}

export function titleFromFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const base = filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : null;
}

/* -------------------------------- Chapters -------------------------------- */

function normalizeForMatch(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cleanChapterTitle(text: string) {
  return smartTitleCase(text.replace(/[.:;,\s]+$/, "").trim()).slice(0, 160);
}

function detectChapterMarkers(clean: CleanDocument, extracted: ExtractedDocument, bookTitle: string | null) {
  const fromOutline = markersFromOutline(clean, extracted);
  if (fromOutline.length >= 2) return { markers: fromOutline, source: "outline" as const };

  const fromLabels = markersFromLabeledHeadings(clean);
  if (fromLabels.length >= 2) return { markers: fromLabels, source: "headings" as const };

  const fromSizes = markersFromHeadingSizes(clean, bookTitle);
  if (fromSizes.length >= 2) return { markers: fromSizes, source: "headings" as const };

  return { markers: [] as ChapterMarker[], source: "none" as const };
}

function markersFromOutline(clean: CleanDocument, extracted: ExtractedDocument): ChapterMarker[] {
  const entries = extracted.outline.filter((entry) => !FRONT_MATTER_RE.test(entry.title.trim()));
  let level = entries.filter((entry) => entry.depth === 0);
  // A single top-level entry usually wraps the whole book; use its children.
  if (level.length === 1) level = entries.filter((entry) => entry.depth === 1);
  if (level.length < 2) return [];

  const pagesByNumber = new Map(clean.pages.map((page) => [page.pageNumber, page]));
  const markers: ChapterMarker[] = [];

  for (const entry of [...level].sort((a, b) => a.pageNumber - b.pageNumber)) {
    const page = pagesByNumber.get(entry.pageNumber);
    const target = normalizeForMatch(entry.title);
    let blockIndex = 0;
    const headingBlocks = new Set<number>();
    if (page) {
      const matchIndex = page.blocks.findIndex((block) => {
        if (block.type !== "heading") return false;
        const text = normalizeForMatch(block.text);
        return text.length > 0 && (text.includes(target) || target.includes(text));
      });
      if (matchIndex >= 0) {
        blockIndex = matchIndex;
        headingBlocks.add(matchIndex);
        // A label heading followed by a title heading ("CHAPTER IV" / "TACTICAL DISPOSITIONS").
        const next = page.blocks[matchIndex + 1];
        if (next?.type === "heading" && !parseChapterHeading(next.text)) {
          const nextText = normalizeForMatch(next.text);
          if (target.includes(nextText)) headingBlocks.add(matchIndex + 1);
        }
      }
    }
    const parsed = parseChapterHeading(entry.title);
    markers.push({
      pageNumber: entry.pageNumber,
      blockIndex,
      headingBlocks,
      title: cleanChapterTitle(parsed?.rest || entry.title),
      label: parsed?.label ?? null,
      labelNumber: parsed?.number ?? null,
    });
  }
  return markers;
}

function markersFromLabeledHeadings(clean: CleanDocument): ChapterMarker[] {
  type Candidate = { page: CleanPage; index: number; parsed: NonNullable<ReturnType<typeof parseChapterHeading>> };
  const candidates: Candidate[] = [];

  for (const page of clean.pages) {
    const onPage: Candidate[] = [];
    page.blocks.forEach((block, index) => {
      const isHeadingLike = block.type === "heading" || (index < 3 && block.text.length <= 80);
      if (!isHeadingLike) return;
      const parsed = parseChapterHeading(block.text);
      if (!parsed) return;
      // For body-text blocks, reject prose ("Part two of the plan was simple.").
      if (block.type !== "heading" && parsed.rest && !/^[\p{Lu}\p{N}"“‘']/u.test(parsed.rest)) return;
      // A title that itself contains another chapter label is a merged contents line.
      if (/\b(chapter|chap\.|part|book|letter)\s+(\d+|[ivxlcdm]+)\b/i.test(parsed.rest)) return;
      onPage.push({ page, index, parsed });
    });
    // Many chapter labels on one page means a table of contents, not chapter starts.
    const labelsOnPage = page.blocks.filter((block) => block.text.length <= 100 && parseChapterHeading(block.text)).length;
    if (labelsOnPage < 3) candidates.push(...onPage);
  }

  const byKeyword = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    byKeyword.set(candidate.parsed.keyword, [...(byKeyword.get(candidate.parsed.keyword) ?? []), candidate]);
  }
  const chosen =
    (byKeyword.get("chapter")?.length ?? 0) >= 2
      ? byKeyword.get("chapter")!
      : [...byKeyword.values()].filter((group) => group.length >= 2).sort((a, b) => b.length - a.length)[0];
  if (!chosen) return [];

  const markers: ChapterMarker[] = [];
  for (const { page, index, parsed } of chosen) {
    const previous = markers[markers.length - 1];
    if (previous && previous.label === parsed.label && page.pageNumber - previous.pageNumber <= 1) continue;

    const headingBlocks = new Set([index]);
    let title = parsed.rest;
    const next = page.blocks[index + 1];
    if (!title && next?.type === "heading" && !parseChapterHeading(next.text) && next.text.length <= 120) {
      title = next.text;
      headingBlocks.add(index + 1);
    }
    markers.push({
      pageNumber: page.pageNumber,
      blockIndex: index,
      headingBlocks,
      title: cleanChapterTitle(title || parsed.label),
      label: parsed.label,
      labelNumber: parsed.number,
    });
  }
  return markers;
}

function markersFromHeadingSizes(clean: CleanDocument, bookTitle: string | null): ChapterMarker[] {
  const titleKey = bookTitle ? normalizeForMatch(bookTitle) : null;
  const headings: { page: CleanPage; index: number; block: CleanBlock }[] = [];
  for (const page of clean.pages) {
    page.blocks.forEach((block, index) => {
      if (block.type !== "heading") return;
      if (FRONT_MATTER_RE.test(block.text.trim())) return;
      if (titleKey && page.pageNumber <= 3 && normalizeForMatch(block.text) === titleKey) return;
      headings.push({ page, index, block });
    });
  }
  if (headings.length < 2) return [];

  const maxSize = Math.max(...headings.map((h) => h.block.fontSize));
  if (maxSize < clean.bodyFontSize * 1.3) return [];
  const top = headings.filter((h) => h.block.fontSize >= maxSize * 0.95);
  if (top.length < 2 || top.length > clean.pages.length * 0.8) return [];

  return top.map(({ page, index, block }) => ({
    pageNumber: page.pageNumber,
    blockIndex: index,
    headingBlocks: new Set([index]),
    title: cleanChapterTitle(block.text),
    label: null,
    labelNumber: null,
  }));
}

/* -------------------------------- Annotation ------------------------------ */

function annotate(cleanPages: CleanPage[], markers: ChapterMarker[]) {
  const sorted = [...markers].sort((a, b) => a.pageNumber - b.pageNumber || a.blockIndex - b.blockIndex);
  const chapters: DetectedChapter[] = sorted.map((marker, i) => ({
    chapterNumber: i + 1,
    title: marker.title,
    label: marker.label,
    labelNumber: marker.labelNumber,
    startPage: marker.pageNumber,
    endPage: marker.pageNumber,
  }));

  let markerIndex = -1;
  let sectionTitle: string | null = null;
  let previousPageChapter: number | null = null;

  const pages: StructuredPage[] = cleanPages.map((page) => {
    const blocks: PageBlock[] = [];
    let pageChapter: number | null | undefined;

    page.blocks.forEach((block, index) => {
      while (
        markerIndex + 1 < sorted.length &&
        (page.pageNumber > sorted[markerIndex + 1].pageNumber ||
          (page.pageNumber === sorted[markerIndex + 1].pageNumber && index >= sorted[markerIndex + 1].blockIndex))
      ) {
        markerIndex++;
        sectionTitle = null;
      }
      const marker = markerIndex >= 0 ? sorted[markerIndex] : null;
      const chapterNumber = marker ? markerIndex + 1 : null;
      const isChapterHeading = !!marker && marker.pageNumber === page.pageNumber && marker.headingBlocks.has(index);

      const annotated: PageBlock = { type: block.type, text: block.text, chapterNumber };
      if (block.type === "heading") {
        if (isChapterHeading) {
          annotated.level = 1;
        } else {
          annotated.level = 2;
          sectionTitle = cleanChapterTitle(block.text);
        }
      }
      annotated.sectionTitle = sectionTitle;
      if (block.continuation) annotated.continuation = true;
      blocks.push(annotated);

      if (pageChapter === undefined) pageChapter = chapterNumber;
      if (chapterNumber) chapters[chapterNumber - 1].endPage = page.pageNumber;
    });

    const chapterNumber = pageChapter === undefined ? previousPageChapter : pageChapter;
    previousPageChapter = chapterNumber ?? previousPageChapter;
    const content = blocks.map((block) => (block.type === "break" ? "* * *" : block.text)).join("\n\n");
    return {
      pageNumber: page.pageNumber,
      pageLabel: page.pageLabel,
      chapterNumber: chapterNumber ?? null,
      blocks,
      content,
      wordCount: countWords(content),
    };
  });

  return { pages, chapters };
}
