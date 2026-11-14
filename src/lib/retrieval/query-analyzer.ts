import { parseNumberToken } from "@/lib/documents/text-utils";
import type { QueryType } from "@/types/domain";

/**
 * Lightweight, deterministic query understanding. It runs on every question,
 * costs nothing, and is easy to test — no extra model call.
 */

export interface ChapterLike {
  id: string;
  chapterNumber: number;
  title: string;
  label: string | null;
  labelNumber: number | null;
}

export interface QueryAnalysis {
  type: QueryType;
  /** Every intent detected, most specific first. */
  intents: QueryType[];
  /** Chapters explicitly referenced ("chapter 3", "chapters 2 and 7", "the last chapter"). */
  chapterIds: string[];
  /** Chapters whose title appears in the question — a soft signal, not a filter. */
  mentionedChapterIds: string[];
  /** Page numbers referenced ("page 42"), as typed by the reader. */
  pageNumbers: number[];
  quotedPhrases: string[];
  keywords: string[];
  /** Heuristic: the question likely depends on earlier turns ("why did she do that?"). */
  looksLikeFollowUp: boolean;
}

const PATTERNS: [QueryType, RegExp][] = [
  ["comparison", /\b(compare|comparison|contrast|differ(s|ence|ences|ent)?|similar(ity|ities)?|versus|vs\.?|in common|distinguish)\b/i],
  ["summarization", /\b(summar(y|ise|ize|ies|ising|izing)|recap|overview|outline|tl;?dr|gist|key points|main points|what happens|sum up)\b/i],
  ["quote", /\b(quote|quotation|exact words|which (page|chapter|passage)|where (does|did|is|in the book)|find the (passage|line|part)|passage where)\b/i],
  ["character", /\b(character|characters|protagonist|antagonist|narrator|personality|relationship|motivat\w*|who is|who was|who are|portray\w*)\b/i],
  ["theme", /\b(themes?|motifs?|symbol\w*|moral|lessons?|message|meaning of the book|allegor\w*)\b/i],
  ["broad", /\b(this book|the book|whole book|entire book|overall|mainly about|central (argument|idea|thesis|message|conflict)|main (idea|argument|thesis|point)|big picture)\b/i],
  ["conceptual", /\b(why|explain|how does|how do|how is|what does .{1,40} mean|concept|idea of|argue|argument|reasoning|implication)\b/i],
];

const ORDINALS: Record<string, number | "last"> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  opening: 1, last: "last", final: "last", closing: "last",
};

const NUMBER_TOKEN = String.raw`\d{1,3}|[ivxlcdm]{1,7}|[a-z]+(?:-[a-z]+)?`;
const CHAPTER_LIST_RE = new RegExp(
  String.raw`\b(chapters?|chaps?\.?|ch\.|parts?|books?|letters?)\s+((?:${NUMBER_TOKEN})(?:\s*(?:,|and|&|or|to|through|thru|-|–)\s*(?:${NUMBER_TOKEN}))*)`,
  "gi",
);
const ORDINAL_CHAPTER_RE = /\b(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|opening|last|final|closing)\s+chapter\b/gi;
const PAGE_RE = /\b(?:pages?|pp?\.|pg\.?)\s*(\d{1,4})(?:\s*(?:-|–|to|and)\s*(\d{1,4}))?\b/gi;
const QUOTE_RE = /["“]([^"”]{3,200})["”]/g;

const STOPWORDS = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our she he so than that the their them then there these they this those to was we were what when where which who whom why will with would you your about book author chapter chapters page explain tell describe".split(
    " ",
  ),
);

function expandNumbers(list: string): number[] {
  const numbers: number[] = [];
  const parts = list.split(/\s*(?:,|and|&|or)\s*/i);
  for (const part of parts) {
    const range = part.split(/\s*(?:to|through|thru|-|–)\s*/i);
    if (range.length === 2) {
      const start = parseNumberToken(range[0]);
      const end = parseNumberToken(range[1]);
      if (start !== null && end !== null && end >= start && end - start <= 20) {
        for (let n = start; n <= end; n++) numbers.push(n);
        continue;
      }
    }
    const value = parseNumberToken(part);
    if (value !== null) numbers.push(value);
  }
  return numbers;
}

function normalize(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function resolveChapter(chapters: ChapterLike[], keyword: string, number: number): ChapterLike | undefined {
  const keywordRoot = keyword.toLowerCase().replace(/s?\.?$/, "").replace(/^chap$|^ch$/, "chapter");
  // Prefer the book's own numbering ("Chapter IV"), then sequential position.
  const exact = chapters.find(
    (chapter) => chapter.labelNumber === number && (chapter.label ?? "").toLowerCase().startsWith(keywordRoot),
  );
  if (exact || keywordRoot !== "chapter") return exact;
  return (
    chapters.find((chapter) => chapter.labelNumber === number && !chapter.label?.toLowerCase().startsWith("part")) ??
    chapters.find((chapter) => chapter.chapterNumber === number)
  );
}

export function analyzeQuery(query: string, chapters: ChapterLike[] = []): QueryAnalysis {
  const text = query.trim();
  const chapterIds = new Set<string>();

  for (const match of text.matchAll(CHAPTER_LIST_RE)) {
    for (const number of expandNumbers(match[2])) {
      const chapter = resolveChapter(chapters, match[1], number);
      if (chapter) chapterIds.add(chapter.id);
    }
  }
  for (const match of text.matchAll(ORDINAL_CHAPTER_RE)) {
    const ordinal = ORDINALS[match[1].toLowerCase()];
    const chapter =
      ordinal === "last"
        ? chapters.reduce<ChapterLike | undefined>((max, c) => (!max || c.chapterNumber > max.chapterNumber ? c : max), undefined)
        : chapters.find((c) => c.chapterNumber === ordinal);
    if (chapter) chapterIds.add(chapter.id);
  }
  // Chapter titles mentioned verbatim ("What happens in 'The Use of Spies'?").
  const mentionedChapterIds = new Set<string>();
  const normalizedQuery = ` ${normalize(text)} `;
  for (const chapter of chapters) {
    const title = normalize(chapter.title);
    const isJustLabel = chapter.label && title === normalize(chapter.label);
    if (!isJustLabel && title.length >= 6 && normalizedQuery.includes(` ${title} `) && !chapterIds.has(chapter.id)) {
      mentionedChapterIds.add(chapter.id);
    }
  }

  const pageNumbers: number[] = [];
  for (const match of text.matchAll(PAGE_RE)) {
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    for (let n = start; n <= Math.min(end, start + 10); n++) pageNumbers.push(n);
  }

  const quotedPhrases = [...text.matchAll(QUOTE_RE)].map((match) => match[1].trim()).filter((phrase) => phrase.split(/\s+/).length >= 2);

  const intents: QueryType[] = PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([type]) => type);
  if (quotedPhrases.length > 0 && !intents.includes("quote")) intents.unshift("quote");
  if (chapterIds.size > 0 && !intents.includes("chapter")) {
    // A chapter reference is more specific than a vague "broad" intent.
    const broadIndex = intents.indexOf("broad");
    if (broadIndex >= 0) intents.splice(broadIndex, 1);
    intents.push("chapter");
  }
  if (intents.length === 0) intents.push("factual");

  const keywords = [...new Set((normalize(text).match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOPWORDS.has(w)))];

  const words = text.split(/\s+/).length;
  const looksLikeFollowUp =
    /^(and|but|so|also|then|what about|how about|why|how so|ok|okay|really|more)\b/i.test(text) ||
    /\b(elaborate|explain further|tell me more|go on|expand on|the same|previous|earlier|you mentioned|that one)\b/i.test(text) ||
    (words <= 14 && /\b(it|its|this|that|these|those|they|them|their|he|him|his|she|her|hers|there)\b/i.test(text)) ||
    words <= 3;

  return {
    type: intents[0],
    intents,
    chapterIds: [...chapterIds],
    mentionedChapterIds: [...mentionedChapterIds],
    pageNumbers: [...new Set(pageNumbers)],
    quotedPhrases,
    keywords,
    looksLikeFollowUp,
  };
}

/** How many passages to send to the model for each kind of question. */
export function topKForQuery(analysis: QueryAnalysis, base: number): number {
  switch (analysis.type) {
    case "summarization":
    case "broad":
      return Math.max(base, 10);
    case "comparison":
    case "theme":
    case "character":
      return Math.max(base, 8);
    case "quote":
      return Math.min(base, 5);
    default:
      return base;
  }
}
