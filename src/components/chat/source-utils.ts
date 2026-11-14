import type { SourceDTO } from "@/types/api";

/** "Chapter IV" (or the chapter title when there is no label). */
export function chapterLabelOf(source: Pick<SourceDTO, "chapterLabel" | "chapterTitle">): string | null {
  return source.chapterLabel ?? source.chapterTitle ?? null;
}

/** The chapter title when it adds information beyond the label. */
export function chapterSubtitleOf(source: Pick<SourceDTO, "chapterLabel" | "chapterTitle" | "sectionTitle">): string | null {
  const title = source.chapterTitle && source.chapterTitle !== source.chapterLabel ? source.chapterTitle : null;
  return [title, source.sectionTitle].filter(Boolean).join(" · ") || null;
}

export function pageLabelOf(source: Pick<SourceDTO, "pageStart" | "pageEnd" | "pageLabel">): string {
  if (source.pageLabel) return `Page ${source.pageLabel}`;
  return source.pageEnd > source.pageStart ? `Pages ${source.pageStart}–${source.pageEnd}` : `Page ${source.pageStart}`;
}

/** "Chapter 12 · Page 184" */
export function sourceLocation(source: SourceDTO): string {
  return [chapterLabelOf(source), pageLabelOf(source)].filter(Boolean).join(" · ");
}

export function citationNumber(label: string) {
  return label.replace(/^S/i, "");
}
