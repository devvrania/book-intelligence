import OpenAI from "openai";
import { describe, expect, it, vi } from "vitest";

import { AIProviderError, type EmbeddingProvider, type EmbeddingResult } from "@/lib/ai";
import { mapOpenAIError } from "@/lib/ai/openai";
import { EmbeddingService } from "@/lib/embeddings/embedding-service";

/** Gemini's real free-tier per-minute error (via its OpenAI-compatible endpoint). */
const GEMINI_PER_MINUTE =
  "You exceeded your current quota, please check your plan and billing details. For more information on this error, " +
  "head to: https://aistudio.google.com/docs/rate-limits.\n* Quota exceeded for metric: " +
  "generativelanguage.googleapis.com/embed_content_free_tier_tokens, limit: 30000, model: gemini-embedding-1.0, " +
  "description: Embed content tokens per minute limit exceeded on Free Tier.\nPlease retry in 50.836996578s.";

const apiError = (status: number, message: string, code?: string) =>
  OpenAI.APIError.generate(status, { message, code }, message, new Headers());

describe("429 classification", () => {
  it("treats a free-tier per-minute limit as a rate limit, with the suggested wait", () => {
    const error = mapOpenAIError(apiError(429, GEMINI_PER_MINUTE));
    expect(error.kind).toBe("rate_limit");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(50_837);
  });

  it("treats a daily limit as quota", () => {
    const error = mapOpenAIError(apiError(429, "Quota exceeded for metric: requests per day. Please retry in 3600s."));
    expect(error.kind).toBe("quota");
    expect(error.retryable).toBe(false);
  });

  it("treats exhausted credits as quota", () => {
    expect(mapOpenAIError(apiError(429, "You exceeded your current quota.", "insufficient_quota")).kind).toBe("quota");
  });

  it("treats a plain 429 as a rate limit", () => {
    expect(mapOpenAIError(apiError(429, "Too many requests")).kind).toBe("rate_limit");
  });
});

/** An embedding provider that is rate-limited for its first `failures` calls. */
class FlakyProvider implements EmbeddingProvider {
  readonly id = "flaky";
  readonly model = "flaky-embed";
  readonly maxBatchSize = 100;
  readonly maxInputTokens = 8000;
  calls: string[][] = [];
  constructor(private failures: number) {}
  async embed(texts: string[]): Promise<EmbeddingResult> {
    this.calls.push(texts);
    if (this.failures-- > 0) throw new AIProviderError("rate_limit", { message: "slow down", retryAfterMs: 5 });
    return { embeddings: texts.map(() => [1, 0, 0]) };
  }
}

describe("embedding under a rate limit", () => {
  it("waits and retries the same batch instead of failing", async () => {
    const provider = new FlakyProvider(2);
    const service = new EmbeddingService(provider, { columnDimensions: 3, rateLimitWaitMs: 5 });
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0; }) as typeof setTimeout);
    try {
      const vectors = await service.embedChunks([{ content: "one" }, { content: "two" }]);
      expect(vectors).toHaveLength(2);
      expect(provider.calls).toHaveLength(3); // two rate-limited attempts, then success
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("keeps each request under the token budget", async () => {
    const provider = new FlakyProvider(0);
    const service = new EmbeddingService(provider, { columnDimensions: 3, maxTokensPerRequest: 50 });
    const word = "lorem ipsum dolor sit amet ".repeat(8); // ~40 tokens each
    await service.embedChunks([{ content: word }, { content: word }, { content: word }]);
    expect(provider.calls.length).toBe(3); // one chunk per request: two would exceed 50 tokens
  });
});
