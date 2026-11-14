import { logger } from "@/lib/logger";

import { extractPdf } from "./pdf-extractor";
import { detectStructure } from "./structure-detector";
import { cleanDocument } from "./text-cleaner";
import { DocumentError, type StructuredDocument } from "./types";

export interface ProcessOptions {
  filename?: string | null;
  maxPages?: number;
  onStage?: (stage: "EXTRACTING" | "DETECTING_STRUCTURE") => Promise<void> | void;
}

/** Minimum amount of extracted text for a PDF to be considered text-based. */
const MIN_TEXT_CHARS = 200;

/**
 * Pure document pipeline: PDF bytes → cleaned, structured pages and chapters.
 * No database or network access, so it is easy to test in isolation.
 */
export class DocumentProcessor {
  async process(data: Uint8Array, options: ProcessOptions = {}): Promise<StructuredDocument> {
    await options.onStage?.("EXTRACTING");
    const started = performance.now();
    const extracted = await extractPdf(data, { maxPages: options.maxPages });

    const textChars = extracted.pages.reduce(
      (sum, page) => sum + page.lines.reduce((lineSum, line) => lineSum + line.text.length, 0),
      0,
    );
    if (textChars < MIN_TEXT_CHARS) {
      throw new DocumentError("no_text", { message: `Only ${textChars} characters of text extracted` });
    }

    await options.onStage?.("DETECTING_STRUCTURE");
    const cleaned = cleanDocument(extracted);
    const structured = detectStructure(cleaned, extracted, { filename: options.filename });

    logger.info("document.processed", {
      pages: extracted.pageCount,
      words: structured.wordCount,
      chapters: structured.chapters.length,
      chapterSource: structured.chapterSource,
      removedBoilerplateLines: cleaned.stats.removedBoilerplateLines,
      removedPageNumbers: cleaned.stats.removedPageNumbers,
      bodyFontSize: cleaned.bodyFontSize,
      durationMs: Math.round(performance.now() - started),
    });
    return structured;
  }
}

/**
 * Render the first page as a PNG cover — but only when it looks like a real
 * cover (it paints an image). Plain-text title pages make poor covers, so the
 * UI's generated cover is used instead. Best effort: returns null when the
 * native canvas module isn't available or rendering fails.
 */
export async function renderCover(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const { getDocumentProxy, getResolvedPDFJS, renderPageAsImage } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(data));
    try {
      const { OPS } = await getResolvedPDFJS();
      const page = await pdf.getPage(1);
      const operators = await page.getOperatorList();
      const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat]);
      if (!operators.fnArray.some((op: number) => imageOps.has(op))) return null;
    } finally {
      await pdf.loadingTask.destroy().catch(() => undefined);
    }

    const image = await renderPageAsImage(new Uint8Array(data), 1, {
      canvasImport: () => import("@napi-rs/canvas"),
      width: 480,
    });
    return new Uint8Array(image);
  } catch (error) {
    logger.warn("document.cover_render_failed", { error });
    return null;
  }
}
