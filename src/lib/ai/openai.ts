import OpenAI from "openai";

import type { TokenUsage } from "@/types/domain";

import {
  AIProviderError,
  type ChatCompletion,
  type ChatProvider,
  type ChatRequest,
  type ChatStreamEvent,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./types";

export interface OpenAIClientOptions {
  apiKey: string;
  baseURL?: string;
}

export function createOpenAIClient({ apiKey, baseURL }: OpenAIClientOptions) {
  // The SDK retries 408/409/429/5xx with exponential backoff and honours Retry-After.
  return new OpenAI({ apiKey, baseURL, maxRetries: 4, timeout: 90_000 });
}

export function mapOpenAIError(error: unknown): AIProviderError {
  if (error instanceof AIProviderError) return error;
  if (error instanceof OpenAI.APIConnectionError) {
    return new AIProviderError("unavailable", { cause: error, message: error.message });
  }
  if (error instanceof OpenAI.APIError) {
    const message = error.message;
    if (error.status === 401 || error.status === 403) return new AIProviderError("auth", { cause: error, message });
    if (error.status === 429) return classify429(error, message);
    if (error.status === 400 && /context length|maximum context|too many tokens/i.test(message)) {
      return new AIProviderError("context_length", { cause: error, message });
    }
    if (error.status && error.status >= 500) return new AIProviderError("unavailable", { cause: error, message });
    if (error.status === 400 || error.status === 404 || error.status === 422) {
      return new AIProviderError("invalid_request", { cause: error, message });
    }
  }
  return new AIProviderError("unknown", {
    cause: error,
    message: error instanceof Error ? error.message : String(error),
  });
}

/**
 * A 429 is either "slow down" (retry soon) or "out of credits / used up for today" (retrying won't help).
 * Free tiers blur the two: Gemini's per-minute limit says "You exceeded your current quota, please check your plan
 * and billing details" and "Please retry in 50.8s". So per-minute limits are rate limits (with the suggested wait),
 * daily limits and real billing problems are quota.
 */
function classify429(error: InstanceType<typeof OpenAI.APIError>, message: string): AIProviderError {
  const code = (error as { code?: string | null }).code ?? "";
  const text = `${code} ${message}`;
  const header = error.headers?.get?.("retry-after");
  const hinted = /retry in ([\d.]+)\s*s/i.exec(text)?.[1] ?? header ?? undefined;
  const retryAfterMs = hinted && Number.isFinite(Number(hinted)) ? Math.ceil(Number(hinted) * 1000) : undefined;

  if (/per ?day|PerDay/i.test(text)) return new AIProviderError("quota", { cause: error, message });
  if (/per ?minute|PerMinute/i.test(text)) return new AIProviderError("rate_limit", { cause: error, message, retryAfterMs });
  if (/insufficient_quota|credit|billing|quota/i.test(text)) return new AIProviderError("quota", { cause: error, message });
  return new AIProviderError("rate_limit", { cause: error, message, retryAfterMs });
}

function toUsage(usage: OpenAI.Completions.CompletionUsage | null | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

/* ------------------------------- Embeddings ------------------------------- */

/**
 * Embedding models reached through an OpenAI-compatible API. Besides OpenAI's own, this covers Google's Gemini
 * embedding model via its OpenAI-compatible endpoint (OPENAI_BASE_URL), which takes much shorter inputs.
 */
const isGeminiEmbedding = (model: string) => model.startsWith("gemini-embedding");

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly id = "openai";
  readonly maxBatchSize: number;
  /** Gemini embeds up to 2,048 of its own tokens; leave headroom since we count with OpenAI's tokenizer. */
  readonly maxInputTokens: number;

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    /** Requested output size (text-embedding-3 models can shorten their vectors). */
    private readonly dimensions: number,
    batchSize = 64,
  ) {
    this.maxBatchSize = batchSize;
    this.maxInputTokens = isGeminiEmbedding(model) ? 1800 : 8191;
  }

  async embed(texts: string[], options: { signal?: AbortSignal } = {}): Promise<EmbeddingResult> {
    if (texts.length === 0) return { embeddings: [] };
    try {
      // text-embedding-3-* and Gemini's embedding model support shortening via `dimensions`; older models don't.
      const supportsDimensions = this.model.startsWith("text-embedding-3") || isGeminiEmbedding(this.model);
      const response = await this.client.embeddings.create(
        {
          model: this.model,
          input: texts,
          encoding_format: "float",
          ...(supportsDimensions ? { dimensions: this.dimensions } : {}),
        },
        { signal: options.signal },
      );
      const embeddings = [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
      return { embeddings, usage: { promptTokens: response.usage?.prompt_tokens } };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }
}

/* ---------------------------------- Chat ---------------------------------- */

export interface OpenAIChatOptions {
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  temperature?: number;
}

export class OpenAIChatProvider implements ChatProvider {
  readonly id = "openai";

  constructor(
    private readonly client: OpenAI,
    readonly model: string,
    private readonly options: OpenAIChatOptions = {},
  ) {}

  /** Only send optional parameters when configured: not every model accepts them. */
  private params(request: ChatRequest) {
    return {
      model: this.model,
      messages: request.messages,
      ...(request.maxOutputTokens ? { max_completion_tokens: request.maxOutputTokens } : {}),
      ...(this.options.reasoningEffort ? { reasoning_effort: this.options.reasoningEffort } : {}),
      ...(this.options.temperature !== undefined ? { temperature: this.options.temperature } : {}),
      ...(request.json ? { response_format: { type: "json_object" as const } } : {}),
    };
  }

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    try {
      const response = await this.client.chat.completions.create(
        { ...this.params(request), stream: false },
        { signal: request.signal },
      );
      const choice = response.choices[0];
      return {
        text: choice?.message?.content ?? "",
        model: response.model,
        usage: toUsage(response.usage),
        finishReason: choice?.finish_reason,
      };
    } catch (error) {
      throw mapOpenAIError(error);
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    let stream;
    try {
      stream = await this.client.chat.completions.create(
        { ...this.params(request), stream: true, stream_options: { include_usage: true } },
        { signal: request.signal },
      );
    } catch (error) {
      throw mapOpenAIError(error);
    }

    let model = this.model;
    let usage: TokenUsage | undefined;
    let finishReason: string | null | undefined;
    try {
      for await (const chunk of stream) {
        model = chunk.model || model;
        if (chunk.usage) usage = toUsage(chunk.usage);
        const choice = chunk.choices[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (delta) yield { type: "delta", text: delta };
      }
    } catch (error) {
      throw mapOpenAIError(error);
    }
    yield { type: "done", model, usage, finishReason };
  }
}
