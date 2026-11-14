import type { ChunkingConfig } from "@/lib/config/env";
import type { ChunkMetadata } from "@/types/domain";

import { splitSentences } from "./text-utils";
import { countTokens, splitByTokens } from "./tokenizer";
import type { ChunkDraft, DetectedChapter, StructuredPage } from "./types";

/**
 * Hierarchical, structure-aware chunking.
 *
 * Boundaries are respected in priority order:
 *   1. chapters and sections (hard boundaries; tiny sections merge with a neighbour)
 *   2. paragraphs (chunks are packed from whole paragraphs)
 *   3. sentences (only when a paragraph alone exceeds the size limit)
 *   4. tokens (last resort for pathological sentences)
 *
 * Consecutive chunks inside a section share a sentence-aligned overlap so an
 * argument that straddles a boundary is retrievable from either side.
 */

interface Paragraph {
  id: number;
  text: string;
  tokens: number;
  pageStart: number;
  pageEnd: number;
}

interface Segment {
  chapterNumber: number | null;
  sectionTitle: string | null;
  headings: string[];
  paragraphs: Paragraph[];
  tokens: number;
}

interface Piece {
  paragraphId: number;
  text: string;
  tokens: number;
  pageStart: number;
  pageEnd: number;
  /** True when this piece is a sentence split out of a longer paragraph. */
  split?: boolean;
}

interface Draft {
  overlap: Piece[];
  parts: Piece[];
  tokens: number;
}

/** Budget for the separator ("\n\n" or " ") added when pieces are joined. */
const JOIN_TOKENS = 2;
const cost = (piece: Pick<Piece, "tokens">) => piece.tokens + JOIN_TOKENS;

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  targetTokens: 700,
  maxTokens: 900,
  minTokens: 180,
  overlapTokens: 120,
};

export class ChunkingService {
  private nextParagraphId = 0;

  constructor(private readonly config: ChunkingConfig = DEFAULT_CHUNKING_CONFIG) {}

  chunk(pages: StructuredPage[], chapters: Pick<DetectedChapter, "chapterNumber" | "title" | "label">[]): ChunkDraft[] {
    this.nextParagraphId = 0;
    const chapterByNumber = new Map(chapters.map((chapter) => [chapter.chapterNumber, chapter]));
    const segments = this.mergeSmallSegments(this.collectSegments(pages));

    const drafts: ChunkDraft[] = [];
    for (const segment of segments) {
      for (const draft of this.packSegment(segment)) {
        const chapter = segment.chapterNumber ? chapterByNumber.get(segment.chapterNumber) : undefined;
        const content = render([...draft.overlap, ...draft.parts]);
        const overlapChars = draft.overlap.length ? content.length - render(draft.parts).length : 0;
        const metadata: ChunkMetadata = {
          chapterTitle: chapter?.title ?? null,
          chapterLabel: chapter?.label ?? null,
          sectionTitle: segment.sectionTitle,
          headings: segment.headings,
          paragraphCount: new Set(draft.parts.map((part) => part.paragraphId)).size,
          overlapChars,
          overlapTokens: draft.overlap.reduce((sum, piece) => sum + piece.tokens, 0),
        };
        drafts.push({
          chunkIndex: drafts.length,
          content,
          tokenCount: countTokens(content),
          pageStart: Math.min(...draft.parts.map((part) => part.pageStart)),
          pageEnd: Math.max(...draft.parts.map((part) => part.pageEnd)),
          chapterNumber: segment.chapterNumber,
          sectionTitle: segment.sectionTitle,
          metadata,
        });
      }
    }
    return drafts;
  }

  /* --------------------------- 1. Segmentation --------------------------- */

  private collectSegments(pages: StructuredPage[]): Segment[] {
    const segments: Segment[] = [];
    // Assigned inside `start`; the cast stops TypeScript narrowing it to `null`.
    let current = null as Segment | null;

    const start = (chapterNumber: number | null, sectionTitle: string | null) => {
      current = { chapterNumber, sectionTitle, headings: [], paragraphs: [], tokens: 0 };
      segments.push(current);
      return current;
    };

    for (const page of pages) {
      for (const block of page.blocks) {
        const chapterNumber = block.chapterNumber ?? null;
        const sectionTitle = block.level === 1 ? null : (block.sectionTitle ?? null);

        if (block.type === "heading") {
          const seg: Segment | null = current;
          // Consecutive headings ("CHAPTER IV" + "TACTICAL DISPOSITIONS") share one segment.
          const target: Segment =
            seg && seg.paragraphs.length === 0 && seg.chapterNumber === chapterNumber
              ? seg
              : start(chapterNumber, sectionTitle);
          target.sectionTitle = sectionTitle ?? target.sectionTitle;
          target.headings.push(block.text);
          continue;
        }

        if (block.type === "break") {
          const seg: Segment | null = current;
          if (seg && seg.paragraphs.length > 0) start(chapterNumber, sectionTitle);
          continue;
        }

        let seg: Segment | null = current;
        if (!seg || seg.chapterNumber !== chapterNumber || seg.sectionTitle !== sectionTitle) {
          seg = start(chapterNumber, sectionTitle);
        }

        const last = seg.paragraphs[seg.paragraphs.length - 1];
        if (block.continuation && last) {
          // A paragraph split by a page break is one paragraph.
          last.text = /[\p{L}]-$/u.test(last.text) && /^[\p{Ll}]/u.test(block.text)
            ? last.text.slice(0, -1) + block.text
            : `${last.text} ${block.text}`;
          last.pageEnd = page.pageNumber;
        } else {
          seg.paragraphs.push({
            id: this.nextParagraphId++,
            text: block.text,
            tokens: 0,
            pageStart: page.pageNumber,
            pageEnd: page.pageNumber,
          });
        }
      }
    }

    const nonEmpty = segments.filter((segment) => segment.paragraphs.length > 0);
    for (const segment of nonEmpty) {
      for (const paragraph of segment.paragraphs) paragraph.tokens = countTokens(paragraph.text);
      segment.tokens = segment.paragraphs.reduce((sum, paragraph) => sum + paragraph.tokens, 0);
    }
    return nonEmpty;
  }

  /** Merge sections that are too small to stand alone into a neighbour in the same chapter. */
  private mergeSmallSegments(segments: Segment[]): Segment[] {
    const { minTokens, maxTokens } = this.config;
    const result: Segment[] = [];
    for (const segment of segments) {
      const previous = result[result.length - 1];
      const canMerge =
        previous &&
        previous.chapterNumber === segment.chapterNumber &&
        (previous.tokens < minTokens || segment.tokens < minTokens) &&
        previous.tokens + segment.tokens <= maxTokens;

      if (!canMerge) {
        result.push(segment);
        continue;
      }
      // Keep the merged section's heading inline so the structure isn't lost.
      if (segment.headings.length > 0) {
        const text = segment.headings.join(" — ");
        const tokens = countTokens(text);
        const first = segment.paragraphs[0];
        previous.paragraphs.push({ id: this.nextParagraphId++, text, tokens, pageStart: first.pageStart, pageEnd: first.pageStart });
        previous.tokens += tokens;
      }
      previous.paragraphs.push(...segment.paragraphs);
      previous.tokens += segment.tokens;
      previous.headings.push(...segment.headings);
      previous.sectionTitle ??= segment.sectionTitle;
    }
    return result;
  }

  /* ------------------------------ 2. Packing ----------------------------- */

  private packSegment(segment: Segment): Draft[] {
    const { targetTokens, maxTokens, minTokens } = this.config;
    const queue: Piece[] = segment.paragraphs.flatMap((paragraph) =>
      cost(paragraph) > maxTokens ? this.splitPiece(toPiece(paragraph)) : [toPiece(paragraph)],
    );
    const sum = (pieces: Piece[]) => pieces.reduce((total, piece) => total + cost(piece), 0);

    const drafts: Draft[] = [];
    let current: Draft = { overlap: [], parts: [], tokens: 0 };

    let i = 0;
    while (i < queue.length) {
      const piece = queue[i];

      if (current.parts.length === 0) {
        // Never let the carried-over overlap push a chunk past the hard limit.
        if (current.tokens + cost(piece) > maxTokens) current = { overlap: [], parts: [], tokens: 0 };
        current.parts.push(piece);
        current.tokens += cost(piece);
        i++;
        continue;
      }

      const fits = current.tokens + cost(piece) <= maxTokens;
      if (fits && current.tokens < targetTokens) {
        current.parts.push(piece);
        current.tokens += cost(piece);
        i++;
        continue;
      }

      // The chunk is still small but the next paragraph won't fit: top it up sentence by sentence.
      if (!fits && current.tokens < minTokens && !piece.split) {
        const sentences = this.splitPiece(piece);
        if (sentences.length > 1) {
          queue.splice(i, 1, ...sentences);
          continue;
        }
      }

      drafts.push(current);
      const overlap = this.computeOverlap(current);
      current = { overlap, parts: [], tokens: sum(overlap) };
    }
    if (current.parts.length > 0) drafts.push(current);

    // Fold a tiny trailing chunk into its predecessor when it fits.
    if (drafts.length >= 2) {
      const last = drafts[drafts.length - 1];
      const previous = drafts[drafts.length - 2];
      const lastOwnTokens = sum(last.parts);
      if (lastOwnTokens < minTokens && previous.tokens + lastOwnTokens <= maxTokens) {
        previous.parts.push(...last.parts);
        previous.tokens += lastOwnTokens;
        drafts.pop();
      }
    }
    return drafts;
  }

  /** Split a piece at sentence boundaries; fall back to token windows for giant sentences. */
  private splitPiece(piece: Piece): Piece[] {
    const { maxTokens } = this.config;
    const sentences = splitSentences(piece.text);
    const pieces: Piece[] = [];
    for (const sentence of sentences) {
      const tokens = countTokens(sentence);
      const texts = tokens + JOIN_TOKENS > maxTokens ? splitByTokens(sentence, Math.floor(maxTokens * 0.9)) : [sentence];
      for (const text of texts) {
        pieces.push({ ...piece, text, tokens: texts.length > 1 ? countTokens(text) : tokens, split: true });
      }
    }
    return pieces.length > 0 ? pieces : [piece];
  }

  /** Trailing whole sentences of a chunk, up to the overlap budget. */
  private computeOverlap(draft: Draft): Piece[] {
    const budget = this.config.overlapTokens;
    if (budget <= 0) return [];

    const tail: Piece[] = [];
    let tokens = 0;
    for (let p = draft.parts.length - 1; p >= 0; p--) {
      const part = draft.parts[p];
      const sentences = part.split ? [part] : this.splitPiece(part);
      for (let s = sentences.length - 1; s >= 0; s--) {
        const sentence = sentences[s];
        const allowance = tail.length === 0 ? budget * 1.5 : budget;
        if (tokens + cost(sentence) > allowance) return tail;
        tail.unshift({ ...sentence, split: true });
        tokens += cost(sentence);
      }
    }
    return tail;
  }
}

function toPiece(paragraph: Paragraph): Piece {
  return {
    paragraphId: paragraph.id,
    text: paragraph.text,
    tokens: paragraph.tokens,
    pageStart: paragraph.pageStart,
    pageEnd: paragraph.pageEnd,
  };
}

/** Sentences of the same paragraph are joined with a space; paragraphs with a blank line. */
function render(pieces: Piece[]): string {
  let out = "";
  let previousParagraph: number | null = null;
  for (const piece of pieces) {
    if (out) out += piece.paragraphId === previousParagraph ? " " : "\n\n";
    out += piece.text;
    previousParagraph = piece.paragraphId;
  }
  return out;
}
