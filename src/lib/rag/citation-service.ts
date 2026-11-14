/**
 * Citations come only from retrieved chunks. The model refers to sources by
 * the labels it was given ([S1], [S2], …); this service validates those
 * markers against the sources that were actually in the context, removes
 * anything else, and normalizes the format.
 */

export interface CitationResult {
  /** Answer text with only valid, normalized markers ("[S1][S3]"). */
  text: string;
  /** Valid labels in order of first appearance. */
  cited: string[];
  /** Markers the model produced that did not match any source (removed). */
  invalid: string[];
}

const MARKER_RE = /\[\s*(S\s*\d+(?:\s*[,;]\s*S?\s*\d+)*)\s*\]/gi;

export function extractCitations(answer: string, validLabels: Iterable<string>): CitationResult {
  const valid = new Set(validLabels);
  const cited: string[] = [];
  const invalid: string[] = [];

  const text = answer.replace(MARKER_RE, (_, inner: string) => {
    const labels = inner
      .split(/\s*[,;]\s*/)
      .map((part) => `S${part.replace(/^s\s*/i, "").trim()}`)
      .filter(Boolean);
    const kept = labels.filter((label) => {
      if (valid.has(label)) {
        if (!cited.includes(label)) cited.push(label);
        return true;
      }
      if (!invalid.includes(label)) invalid.push(label);
      return false;
    });
    return [...new Set(kept)].map((label) => `[${label}]`).join("");
  });

  return {
    // Tidy whitespace left behind by removed markers (" ." → ".").
    text: text.replace(/[ \t]+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim(),
    cited,
    invalid,
  };
}

/** Strip citation markers (e.g. from previous answers fed back as history). */
export function stripCitations(text: string): string {
  return text.replace(MARKER_RE, "").replace(/[ \t]+([.,;:!?])/g, "$1");
}
