import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";

/**
 * Token counting with the cl100k_base encoding used by OpenAI's
 * text-embedding-3 models. Pure JS, so it runs anywhere (worker, tests).
 */

let encoder: Tiktoken | undefined;

function getEncoder() {
  encoder ??= new Tiktoken(cl100k_base);
  return encoder;
}

export function countTokens(text: string): number {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

/** Truncate text to at most `maxTokens` tokens. */
export function truncateToTokens(text: string, maxTokens: number): string {
  const enc = getEncoder();
  const tokens = enc.encode(text);
  if (tokens.length <= maxTokens) return text;
  return enc.decode(tokens.slice(0, maxTokens));
}

/** Split text into consecutive pieces of at most `maxTokens` tokens (last-resort splitting). */
export function splitByTokens(text: string, maxTokens: number): string[] {
  const enc = getEncoder();
  const tokens = enc.encode(text);
  const pieces: string[] = [];
  for (let i = 0; i < tokens.length; i += maxTokens) {
    pieces.push(enc.decode(tokens.slice(i, i + maxTokens)).trim());
  }
  return pieces.filter(Boolean);
}
