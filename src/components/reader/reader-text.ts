import type { ChapterSummary } from "@/types/api";
import type { PageBlock } from "@/types/domain";

/**
 * Pure text helpers for the reader: query-term matching, passage matching
 * and laying out a page's blocks. Everything works on plain strings so book
 * text is only ever rendered as text nodes.
 */

export const normalizeWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Chapter IV · Tactical Dispositions", without repeating a title that is just the label. */
export function chapterLine(label: string | null, title: string | null): string | null {
  if (label && title && !sameText(label, title)) return `${label} · ${title}`;
  return title ?? label ?? null;
}

/**
 * Returns a predicate telling whether a paragraph belongs to a passage
 * (a retrieved chunk): the passage contains the paragraph's text, or at least
 * its opening ~80 characters (paragraphs can be cut at chunk boundaries).
 */
export function createPassageMatcher(content: string, overlapChars = 0): (text: string) => boolean {
  const own = overlapChars > 0 && overlapChars < content.length ? content.slice(overlapChars) : content;
  const haystack = normalizeWhitespace(own).toLowerCase();
  return (text: string) => {
    const needle = normalizeWhitespace(text).toLowerCase();
    if (needle.length < 2) return false;
    if (haystack.includes(needle)) return true;
    return needle.length > 80 && haystack.includes(needle.slice(0, 80));
  };
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------

export type LayoutItem =
  | { kind: "chapter"; key: string; eyebrow: string | null; titles: string[] }
  | { kind: "section"; key: string; text: string }
  | { kind: "paragraph"; key: string; text: string; indent: boolean; dropCap: boolean }
  | { kind: "break"; key: string };

const LABEL_LIKE =
  /^(?:(?:chapter|book|part|volume|vol\.|letter|act|canto|section)\s+(?:[ivxlcdm]+|\d+|[a-z]+(?:[- ][a-z]+)?)|[ivxlcdm]+|\d+)\.?$/i;

const ROMAN = /^M{0,4}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to"]);

/** "THE ART OF WAR" → "The Art of War" (roman numerals stay upper-case). Mixed-case text is untouched. */
export function softenCaps(text: string): string {
  if (!/\p{Lu}/u.test(text) || /\p{Ll}/u.test(text) || text.length > 120) return text;
  return text
    .split(/(\s+)/)
    .map((word, index) => {
      if (!word.trim()) return word;
      const bare = word.replace(/[^\p{L}]/gu, "");
      if (bare && ROMAN.test(bare)) return word;
      const lower = word.toLowerCase();
      if (index > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.replace(/\p{L}/u, (letter) => letter.toUpperCase());
    })
    .join("");
}

const STARTS_WITH_LETTER = /^["“‘'(]?\p{L}/u;

/**
 * Turn a page's blocks into render items: runs of chapter headings become a
 * chapter opener ("CHAPTER II" eyebrow + "Waging War" title), and paragraphs
 * get book typography — a first-line indent except after a heading or break,
 * none for a paragraph continued from the previous page, and a drop cap for
 * the first paragraph of a chapter.
 */
export function layoutBlocks(blocks: PageBlock[]): LayoutItem[] {
  const items: LayoutItem[] = [];
  let previous: LayoutItem["kind"] | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const text = block.text.trim();

    if (block.type === "heading" && (block.level ?? 1) === 1) {
      const run = [text];
      while (i + 1 < blocks.length && blocks[i + 1].type === "heading" && (blocks[i + 1].level ?? 1) === 1) {
        run.push(blocks[++i].text.trim());
      }
      const hasEyebrow = run.length >= 2 && LABEL_LIKE.test(run[0]);
      items.push({
        kind: "chapter",
        key: `h1-${i}`,
        eyebrow: hasEyebrow ? run[0] : null,
        titles: (hasEyebrow ? run.slice(1) : run).filter(Boolean).map(softenCaps),
      });
      previous = "chapter";
      continue;
    }

    if (block.type === "heading") {
      if (text) items.push({ kind: "section", key: `h2-${i}`, text: softenCaps(text) });
      previous = "section";
      continue;
    }

    if (block.type === "break") {
      items.push({ kind: "break", key: `br-${i}` });
      previous = "break";
      continue;
    }

    if (!text) continue;
    const afterHeading = previous === "chapter" || previous === "section" || previous === "break";
    items.push({
      kind: "paragraph",
      key: `p-${i}`,
      text: block.text,
      indent: !block.continuation && !afterHeading,
      dropCap: previous === "chapter" && !block.continuation && STARTS_WITH_LETTER.test(text),
    });
    previous = "paragraph";
  }

  return items;
}

/** Plain text of a page, for phrase detection. */

/**
 * The chapter a page belongs to: the one whose range contains it, else (for a
 * gap between chapters) the last chapter that started before it. Front and
 * back matter belong to no chapter.
 */
export function chapterForPage(chapters: ChapterSummary[], page: number): ChapterSummary | null {
  let started: ChapterSummary | null = null;
  let lastPage = 0;
  for (const chapter of chapters) {
    if (chapter.startPage <= page && page <= chapter.endPage) return chapter;
    if (chapter.startPage <= page && (!started || chapter.startPage >= started.startPage)) started = chapter;
    lastPage = Math.max(lastPage, chapter.endPage);
  }
  return started && page <= lastPage ? started : null;
}

export const clampPage = (page: number, pageCount: number) =>
  Math.min(Math.max(1, Math.round(page) || 1), Math.max(1, pageCount));
