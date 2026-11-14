import { parseNumberToken } from "./text-utils";

const KEYWORDS = "chapter|chap\\.?|book|part|letter|canto|act|lecture|lesson|stave";
const NUMBER = "\\d{1,3}|[ivxlcdm]{1,8}|[a-z]+(?:[-\\s][a-z]+)?";

const HEADING_RE = new RegExp(`^(${KEYWORDS})\\s+(${NUMBER})\\b\\.?\\s*(?:[:.\\-–—]\\s*)?(.*)$`, "i");

export interface ParsedChapterHeading {
  /** Normalized keyword: "chapter", "part", "book", … */
  keyword: string;
  /** Display label, e.g. "Chapter IV". */
  label: string;
  number: number;
  /** Title text after the label when it is on the same line. */
  rest: string;
}

function displayNumber(token: string): string {
  if (/^\d+$/.test(token)) return token;
  if (/^[ivxlcdm]+$/i.test(token)) return token.toUpperCase();
  return token
    .toLowerCase()
    .split(/([-\s])/)
    .map((part) => (/^[-\s]$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

/**
 * Parse headings like "Chapter IV. Tactical Dispositions", "CHAPTER 3: The
 * Garden", "Part One" or "Letter 12". Returns null for prose that merely
 * starts with such a word ("Part of the problem…").
 */
export function parseChapterHeading(text: string): ParsedChapterHeading | null {
  const match = text.trim().match(HEADING_RE);
  if (!match) return null;
  const [, rawKeyword, numberToken, rest] = match;

  // A number phrase can swallow the first title word ("One Morning"); retry shorter.
  const words = numberToken.split(/[-\s]/);
  for (let take = words.length; take >= 1; take--) {
    const candidate = words.slice(0, take).join(numberToken.includes("-") ? "-" : " ");
    const number = parseNumberToken(candidate);
    if (number === null || number <= 0 || number >= 1000) continue;

    const leftover = words.slice(take).join(" ");
    const title = [leftover, rest].filter(Boolean).join(" ").replace(/^[:.\-–—\s]+/, "").trim();
    const keyword = rawKeyword.toLowerCase().replace(/\.$/, "").replace(/^chap$/, "chapter");
    return {
      keyword,
      label: `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)} ${displayNumber(candidate)}`,
      number,
      rest: title,
    };
  }
  return null;
}

export function isChapterHeading(text: string): boolean {
  return parseChapterHeading(text) !== null;
}

/** Titles of outline entries / headings that are front matter, not chapters. */
export const FRONT_MATTER_RE =
  /^(cover|title( page)?|half[- ]title|copyright|contents|table of contents|dedication|epigraph|frontispiece|illustrations|list of illustrations)$/i;
