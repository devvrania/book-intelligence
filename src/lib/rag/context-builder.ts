import { truncate } from "@/lib/documents/text-utils";
import type { RankedChunk } from "@/lib/retrieval/reranking-service";
import type { SourceSnapshot } from "@/types/domain";

export interface ContextSource {
  /** Label shown to the model and the reader, e.g. "S1". */
  label: string;
  rank: number;
  chunk: RankedChunk;
  snapshot: SourceSnapshot;
}

export interface BuiltContext {
  sources: ContextSource[];
  /** The <book_context> block for the prompt (empty string when no sources). */
  block: string;
  tokens: number;
}

/** Per-source overhead of the wrapper tags, in tokens (approximate). */
const SOURCE_OVERHEAD_TOKENS = 40;

/**
 * Neutralize anything in book text that could close or forge our delimiters,
 * so a passage can never "escape" the data section of the prompt.
 */
export function sanitizeBookText(text: string): string {
  return text
    .replace(/<\s*(\/?)\s*(book_context|source|selected_passage|system|instructions?|user|assistant)\b[^>]*>/gi, "‹$1$2›")
    .replace(/```/g, "ʼʼʼ");
}

function escapeAttribute(value: string) {
  return value.replace(/["<>]/g, "");
}

export function pageRange(start: number, end: number) {
  return start === end ? `${start}` : `${start}–${end}`;
}

export function chapterName(chunk: Pick<RankedChunk, "chapterLabel" | "chapterTitle">): string | null {
  const parts = [chunk.chapterLabel, chunk.chapterTitle].filter(
    (value, index, all): value is string => !!value && all.indexOf(value) === index,
  );
  return parts.length ? parts.join(": ") : null;
}

/** The passage minus the overlap repeated from the previous chunk, for display. */
export function excerptOf(chunk: Pick<RankedChunk, "content" | "metadata">, maxLength = 320): string {
  const body = chunk.content.slice(chunk.metadata?.overlapChars ?? 0).trim() || chunk.content;
  return truncate(body.replace(/\s+/g, " "), maxLength);
}

/**
 * Select passages within the token budget (highest score first), then present
 * them in book order — narrative order helps the model reason about sequence.
 */
export function buildContext(ranked: RankedChunk[], options: { maxTokens: number }): BuiltContext {
  const chosen: RankedChunk[] = [];
  let tokens = 0;
  for (const chunk of [...ranked].sort((a, b) => b.score - a.score)) {
    const cost = chunk.tokenCount + SOURCE_OVERHEAD_TOKENS;
    if (tokens + cost > options.maxTokens && chosen.length > 0) continue;
    chosen.push(chunk);
    tokens += cost;
  }
  chosen.sort((a, b) => a.chunkIndex - b.chunkIndex);

  const sources: ContextSource[] = chosen.map((chunk, index) => ({
    label: `S${index + 1}`,
    rank: index + 1,
    chunk,
    snapshot: {
      chapterTitle: chunk.chapterTitle,
      chapterLabel: chunk.chapterLabel,
      chapterNumber: chunk.chapterNumber,
      sectionTitle: chunk.sectionTitle,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      pageLabel: null,
      excerpt: excerptOf(chunk),
      content: chunk.content,
    },
  }));

  const block = sources.length
    ? `<book_context>\n${sources
        .map(({ label, chunk }) => {
          const attributes = [
            `id="${label}"`,
            chapterName(chunk) ? `chapter="${escapeAttribute(chapterName(chunk)!)}"` : null,
            chunk.sectionTitle ? `section="${escapeAttribute(chunk.sectionTitle)}"` : null,
            `pages="${pageRange(chunk.pageStart, chunk.pageEnd)}"`,
          ]
            .filter(Boolean)
            .join(" ");
          return `<source ${attributes}>\n${sanitizeBookText(chunk.content)}\n</source>`;
        })
        .join("\n\n")}\n</book_context>`
    : "";

  return { sources, block, tokens };
}
