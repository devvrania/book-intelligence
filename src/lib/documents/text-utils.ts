/**
 * Small, dependency-free text helpers shared by the document pipeline and
 * query understanding.
 */

const LIGATURES: Record<string, string> = {
  "ﬀ": "ff",
  "ﬁ": "fi",
  "ﬂ": "fl",
  "ﬃ": "ffi",
  "ﬄ": "ffl",
  "ﬅ": "st",
  "ﬆ": "st",
};

/** Normalize unicode artifacts from PDF extraction without changing meaning. */
export function normalizeText(text: string): string {
  return text
    .replace(/[ﬀ-ﬆ]/g, (ch) => LIGATURES[ch] ?? ch)
    .replace(/­/g, "") // soft hyphen
    .replace(/[​-‍⁠﻿]/g, "") // zero-width characters
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") // control characters
    .replace(/[  -   　]/g, " ") // exotic spaces
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/* --------------------------------- Numbers -------------------------------- */

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };

export function romanToNumber(input: string): number | null {
  const roman = input.toLowerCase();
  if (!/^[ivxlcdm]+$/.test(roman)) return null;
  let total = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = ROMAN[roman[i]];
    const next = ROMAN[roman[i + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  // Reject non-canonical numerals like "iiii" or "vx".
  return total > 0 && numberToRoman(total) === roman ? total : null;
}

export function numberToRoman(value: number): string {
  const table: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let remaining = value;
  let out = "";
  for (const [n, s] of table) {
    while (remaining >= n) {
      out += s;
      remaining -= n;
    }
  }
  return out;
}

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINAL_UNITS = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"];
const ORDINAL_TENS = ["", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"];

const WORD_NUMBERS = new Map<string, number>();
for (let n = 1; n < 100; n++) {
  if (n < 20) {
    WORD_NUMBERS.set(UNITS[n], n);
    WORD_NUMBERS.set(ORDINAL_UNITS[n], n);
  } else {
    const tens = Math.floor(n / 10);
    const unit = n % 10;
    if (unit === 0) {
      WORD_NUMBERS.set(TENS[tens], n);
      WORD_NUMBERS.set(ORDINAL_TENS[tens], n);
    } else {
      for (const sep of ["-", " "]) {
        WORD_NUMBERS.set(`${TENS[tens]}${sep}${UNITS[unit]}`, n);
        WORD_NUMBERS.set(`${TENS[tens]}${sep}${ORDINAL_UNITS[unit]}`, n);
      }
    }
  }
}

/** "4", "IV", "four", "fourth", "twenty-one" → number. */
export function parseNumberToken(token: string): number | null {
  const value = token.trim().toLowerCase().replace(/\.$/, "");
  if (/^\d{1,4}$/.test(value)) return Number.parseInt(value, 10);
  if (WORD_NUMBERS.has(value)) return WORD_NUMBERS.get(value)!;
  // Avoid treating common words ("I", "mix", "dim") as numerals unless short and canonical.
  return romanToNumber(value);
}

/* -------------------------------- Sentences ------------------------------- */

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "mme", "mlle", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "cf", "no",
  "vol", "vols", "pp", "p", "fig", "figs", "ch", "chap", "ed", "eds", "esp", "approx", "col", "gen", "gov",
  "lt", "mt", "rev", "sgt", "capt", "cmdr", "co", "corp", "inc", "ltd", "jan", "feb", "mar", "apr", "jun",
  "jul", "aug", "sep", "sept", "oct", "nov", "dec", "u.s", "u.k", "viz", "al", "op", "cit", "ibid",
]);

let segmenter: Intl.Segmenter | undefined;

/**
 * Sentence segmentation using the platform's ICU segmenter, with a repair
 * pass for abbreviations ("Mr. Darcy") and initials ("J. R. Tolkien").
 */
export function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  segmenter ??= new Intl.Segmenter("en", { granularity: "sentence" });

  const raw = Array.from(segmenter.segment(trimmed), (s) => s.segment);
  const sentences: string[] = [];
  for (const segment of raw) {
    const previous = sentences[sentences.length - 1];
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      sentences[sentences.length - 1] = previous + segment;
    } else {
      sentences.push(segment);
    }
  }
  return sentences.map((s) => s.trim()).filter(Boolean);
}

function endsWithAbbreviation(sentence: string): boolean {
  const match = sentence.trimEnd().match(/(?:^|[\s(“"'‘])([A-Za-z](?:\.[A-Za-z])*|[A-Za-z]{1,6})\.$/);
  if (!match) return false;
  const word = match[1];
  if (word.length === 1 && /[A-Z]/.test(word)) return true; // initial
  return ABBREVIATIONS.has(word.toLowerCase());
}

/* ---------------------------------- Case ---------------------------------- */

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "from", "in", "into", "nor", "of", "on", "or", "the", "to", "with"]);

/** "TACTICAL DISPOSITIONS" → "Tactical Dispositions". Leaves mixed-case text alone. */
export function smartTitleCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, index) => {
      if (/^\s+$/.test(word)) return word;
      if (index > 0 && SMALL_WORDS.has(word)) return word;
      // Keep roman numerals upper-case ("iv" → "IV"); cap the value so words like "mix" aren't caught.
      const numeral = romanToNumber(word.replace(/[.,:;]$/, ""));
      if (numeral !== null && numeral <= 100) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
