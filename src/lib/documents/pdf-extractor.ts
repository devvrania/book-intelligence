import { getDocumentProxy } from "unpdf";

import { looksLikePdf } from "./pdf-signature";
import { normalizeText } from "./text-utils";
import { DocumentError, type ExtractedDocument, type ExtractedPage, type OutlineEntry, type PdfTextLine } from "./types";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
}

interface PositionedItem {
  str: string;
  x: number;
  top: number;
  right: number;
  fontSize: number;
}

export interface ExtractOptions {
  maxPages?: number;
  onProgress?: (pagesDone: number, pageCount: number) => void;
}

/**
 * Extract text page-by-page, preserving layout signals (position, font size)
 * that the cleaner and structure detector rely on. Pages are processed one at
 * a time and released, so memory stays flat for long books.
 */
export async function extractPdf(data: Uint8Array, options: ExtractOptions = {}): Promise<ExtractedDocument> {
  if (!looksLikePdf(data)) throw new DocumentError("invalid_pdf", { message: "Missing %PDF- header" });

  let pdf: PdfDocument;
  try {
    // pdf.js may detach the buffer it is given, so always pass a copy.
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "PasswordException") throw new DocumentError("encrypted", { cause: error });
    throw new DocumentError("invalid_pdf", { cause: error });
  }

  try {
    const pageCount = pdf.numPages;
    if (options.maxPages && pageCount > options.maxPages) {
      throw new DocumentError("too_many_pages", { message: `${pageCount} pages > ${options.maxPages}` });
    }

    const [info, pageLabels, outline] = await Promise.all([
      readInfo(pdf),
      pdf.getPageLabels().catch(() => null),
      readOutline(pdf),
    ]);

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = (content.items as unknown[]).filter(
          (item): item is RawTextItem => typeof (item as RawTextItem).str === "string",
        );
        pages.push({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          lines: buildLines(items, viewport.height),
        });
      } finally {
        page.cleanup();
      }
      options.onProgress?.(pageNumber, pageCount);
    }

    return {
      pageCount,
      info,
      outline,
      pageLabels: normalizePageLabels(pageLabels, pageCount),
      pages,
    };
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError("invalid_pdf", { cause: error });
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
}

/* ------------------------------ Line building ----------------------------- */

function buildLines(rawItems: RawTextItem[], pageHeight: number): PdfTextLine[] {
  const items: PositionedItem[] = [];
  for (const item of rawItems) {
    const [a, b, c, d, e, f] = item.transform;
    // Skip rotated text (watermarks, spine text) — it isn't part of the reading flow.
    if (Math.abs(b) > Math.abs(a) * 0.1 || Math.abs(c) > Math.abs(d) * 0.1) continue;
    const fontSize = Math.hypot(c, d) || Math.abs(item.height) || 1;
    if (!item.str) continue;
    items.push({ str: item.str, x: e, top: pageHeight - f, right: e + item.width, fontSize });
  }

  const lines: PdfTextLine[] = [];
  let current: PositionedItem[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const line = mergeLine(current);
    current = [];
    if (!line) return;
    const previous = lines[lines.length - 1];
    // Some PDFs draw the same text twice (fake bold / shadows).
    if (previous && previous.text === line.text && Math.abs(previous.top - line.top) < 2) return;
    lines.push(line);
  };

  for (const item of items) {
    const last = current[current.length - 1];
    if (last) {
      const sameBaseline = Math.abs(item.top - last.top) <= Math.max(last.fontSize, item.fontSize) * 0.45;
      const wentBackwards = item.x < last.x - last.fontSize * 4; // new line on the same baseline (columns)
      if (!sameBaseline || wentBackwards) flush();
    }
    current.push(item);
  }
  flush();

  return lines;
}

function mergeLine(items: PositionedItem[]): PdfTextLine | null {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let previous: PositionedItem | undefined;

  for (const item of sorted) {
    if (previous) {
      // Duplicate glyph runs drawn at (almost) the same position.
      if (item.str === previous.str && Math.abs(item.x - previous.x) < 1) continue;
      const gap = item.x - previous.right;
      const needsSpace = gap > Math.min(item.fontSize, previous.fontSize) * 0.12;
      if (needsSpace && !/\s$/.test(text) && !/^\s/.test(item.str)) text += " ";
    }
    text += item.str;
    previous = item;
  }

  const normalized = normalizeText(text);
  if (!normalized) return null;

  // The dominant font size is that of the longest run of text.
  const dominant = sorted.reduce((best, item) => (item.str.length > best.str.length ? item : best), sorted[0]);
  const left = sorted[0].x;
  const right = Math.max(...sorted.map((item) => item.right));

  return {
    text: normalized,
    x: round(left),
    top: round(dominant.top),
    width: round(right - left),
    fontSize: round(dominant.fontSize),
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

/* ---------------------------- Metadata & outline -------------------------- */

async function readInfo(pdf: PdfDocument): Promise<ExtractedDocument["info"]> {
  try {
    const { info, metadata } = await pdf.getMetadata();
    const record = (info ?? {}) as Record<string, unknown>;
    const fromXmp = (key: string) => {
      try {
        const value = metadata?.get(key);
        return typeof value === "string" ? value : Array.isArray(value) ? String(value[0] ?? "") : undefined;
      } catch {
        return undefined;
      }
    };
    const pick = (value: unknown) => (typeof value === "string" && value.trim() ? normalizeText(value) : undefined);
    return {
      title: pick(record.Title) ?? pick(fromXmp("dc:title")),
      author: pick(record.Author) ?? pick(fromXmp("dc:creator")),
      subject: pick(record.Subject) ?? pick(fromXmp("dc:description")),
    };
  } catch {
    return {};
  }
}

async function readOutline(pdf: PdfDocument): Promise<OutlineEntry[]> {
  let outline: Awaited<ReturnType<PdfDocument["getOutline"]>> | null;
  try {
    outline = await pdf.getOutline();
  } catch {
    return [];
  }
  if (!outline?.length) return [];

  const entries: OutlineEntry[] = [];

  const resolvePage = async (dest: unknown): Promise<number | null> => {
    try {
      const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || explicit.length === 0) return null;
      const ref = explicit[0];
      if (typeof ref === "number") return ref + 1;
      if (ref && typeof ref === "object") return (await pdf.getPageIndex(ref as never)) + 1;
      return null;
    } catch {
      return null;
    }
  };

  const walk = async (items: typeof outline, depth: number) => {
    for (const item of items ?? []) {
      const pageNumber = await resolvePage(item.dest);
      const title = normalizeText(item.title ?? "");
      if (pageNumber && title) entries.push({ title, pageNumber, depth });
      if (item.items?.length && depth < 2) await walk(item.items, depth + 1);
    }
  };

  await walk(outline, 0);
  return entries;
}

function normalizePageLabels(labels: string[] | null, pageCount: number): string[] | null {
  if (!labels || labels.length !== pageCount) return null;
  // Labels identical to physical numbers add nothing.
  const informative = labels.some((label, index) => label && label !== String(index + 1));
  return informative ? labels.map((label) => normalizeText(label ?? "")) : null;
}
