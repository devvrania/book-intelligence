import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Typesets bundled public-domain texts as realistic book PDFs (6×9in pages,
 * justified text, indented paragraphs, running headers, page numbers) so the
 * demo exercises the real ingestion pipeline end to end — including the
 * header/footer removal and paragraph reconstruction.
 */

export interface SeedBook {
  title: string;
  author: string;
  description?: string;
  source?: string;
  chapters: { heading: string; paragraphs: string[] }[];
}

/** Parse the simple seed format: YAML-ish front matter, `# ` chapter headings, blank-line paragraphs. */
export function parseSeedMarkdown(markdown: string): SeedBook {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error("Seed book is missing front matter");
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const index = line.indexOf(":");
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
  );

  const chapters: SeedBook["chapters"] = [];
  for (const block of match[2].split(/\n\s*\n/)) {
    const text = block.trim();
    if (!text) continue;
    if (text.startsWith("# ")) chapters.push({ heading: text.slice(2).trim(), paragraphs: [] });
    else if (chapters.length > 0) chapters[chapters.length - 1].paragraphs.push(text.replace(/\s+/g, " "));
  }

  return { title: meta.title, author: meta.author, description: meta.description, source: meta.source, chapters };
}

const PAGE = { width: 432, height: 648 };
const MARGIN = { top: 66, bottom: 64, left: 54, right: 54 };
const BODY = { size: 11, leading: 15.2, indent: 16 };
const INK = rgb(0.12, 0.11, 0.11);
const GREY = rgb(0.45, 0.43, 0.42);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

export interface BuildOptions {
  /** Write title/author into the PDF info dictionary (default true). */
  metadata?: boolean;
}

export async function buildBookPdf(book: SeedBook, options: BuildOptions = {}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.TimesRoman),
    bold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    italic: await pdf.embedFont(StandardFonts.TimesRomanItalic),
  };
  const supported = new Set(fonts.regular.getCharacterSet());
  const safe = (text: string) => toWinAnsi(text, supported);

  if (options.metadata !== false) {
    pdf.setTitle(book.title);
    pdf.setAuthor(book.author);
    if (book.description) pdf.setSubject(book.description);
    pdf.setCreator("Book Intelligence seed");
  }

  // Title page
  const titlePage = pdf.addPage([PAGE.width, PAGE.height]);
  drawCentered(titlePage, safe(book.title), fonts.bold, 24, PAGE.height * 0.62);
  drawCentered(titlePage, safe(`by ${book.author}`), fonts.italic, 13, PAGE.height * 0.62 - 34);

  let pageNumber = 1;
  for (const chapter of book.chapters) {
    let page = pdf.addPage([PAGE.width, PAGE.height]);
    pageNumber++;
    drawFooter(page, pageNumber, fonts);

    // Chapter heading: "CHAPTER IV" then the title, if any.
    const [label, ...titleParts] = chapter.heading.split(/\.\s+/);
    let y = PAGE.height - MARGIN.top - 56;
    drawCentered(page, safe(label.toUpperCase()), fonts.bold, 16, y);
    const chapterTitle = titleParts.join(". ");
    if (chapterTitle) {
      y -= 24;
      drawCentered(page, safe(chapterTitle), fonts.italic, 14, y);
    }
    y -= 46;

    const runningHeader = chapterTitle || label;
    let firstParagraph = true;

    for (const paragraph of chapter.paragraphs) {
      const lines = wrap(safe(paragraph), fonts.regular, BODY.size, contentWidth(), firstParagraph ? 0 : BODY.indent);
      lines.forEach((line, index) => {
        if (y < MARGIN.bottom) {
          page = pdf.addPage([PAGE.width, PAGE.height]);
          pageNumber++;
          drawFooter(page, pageNumber, fonts);
          drawRunningHeader(page, pageNumber % 2 === 0 ? safe(book.title) : safe(runningHeader), fonts);
          y = PAGE.height - MARGIN.top;
        }
        const indent = index === 0 && !firstParagraph ? BODY.indent : 0;
        const justify = index < lines.length - 1;
        drawLine(page, line, MARGIN.left + indent, y, contentWidth() - indent, fonts.regular, justify);
        y -= BODY.leading;
      });
      firstParagraph = false;
    }
  }

  return pdf.save();
}

const contentWidth = () => PAGE.width - MARGIN.left - MARGIN.right;

function drawCentered(page: PDFPage, text: string, font: PDFFont, size: number, y: number) {
  const width = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE.width - width) / 2, y, size, font, color: INK });
}

function drawRunningHeader(page: PDFPage, text: string, fonts: Fonts) {
  const size = 8.5;
  const width = fonts.italic.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE.width - width) / 2, y: PAGE.height - 38, size, font: fonts.italic, color: GREY });
}

function drawFooter(page: PDFPage, pageNumber: number, fonts: Fonts) {
  const text = String(pageNumber);
  const size = 9;
  const width = fonts.regular.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (PAGE.width - width) / 2, y: 34, size, font: fonts.regular, color: GREY });
}

function wrap(text: string, font: PDFFont, size: number, width: number, firstIndent: number): string[][] {
  const words = text.split(" ").filter(Boolean);
  const space = font.widthOfTextAtSize(" ", size);
  const lines: string[][] = [];
  let current: string[] = [];
  let currentWidth = 0;
  for (const word of words) {
    const wordWidth = font.widthOfTextAtSize(word, size);
    const available = width - (lines.length === 0 ? firstIndent : 0);
    if (current.length > 0 && currentWidth + space + wordWidth > available) {
      lines.push(current);
      current = [];
      currentWidth = 0;
    }
    currentWidth += (current.length > 0 ? space : 0) + wordWidth;
    current.push(word);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Draw words individually; justified lines spread the slack across word gaps, like real typesetting. */
function drawLine(page: PDFPage, words: string[], x: number, y: number, width: number, font: PDFFont, justify: boolean) {
  const size = BODY.size;
  const space = font.widthOfTextAtSize(" ", size);
  const wordsWidth = words.reduce((sum, word) => sum + font.widthOfTextAtSize(word, size), 0);
  const gaps = words.length - 1;
  const gap = justify && gaps > 0 ? Math.min((width - wordsWidth) / gaps, space * 2.2) : space;
  let cursor = x;
  for (const word of words) {
    page.drawText(word, { x: cursor, y, size, font, color: INK });
    cursor += font.widthOfTextAtSize(word, size) + gap;
  }
}

/** Standard PDF fonts only cover WinAnsi; transliterate anything else ("Tzŭ" → "Tzu"). */
function toWinAnsi(text: string, supported: Set<number>): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (supported.has(code)) {
      out += char;
      continue;
    }
    const base = char.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    out += [...base].every((c) => supported.has(c.codePointAt(0)!)) ? base : "?";
  }
  return out;
}
