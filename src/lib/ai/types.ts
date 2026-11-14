import { AppError } from "@/lib/errors";
import type { TokenUsage } from "@/types/domain";

/**
 * Provider-neutral AI interfaces. The RAG pipeline depends only on these, so
 * adding a provider means adding one implementation file — nothing else.
 */

export interface EmbeddingResult {
  embeddings: number[][];
  usage?: { promptTokens?: number };
}

export type EmbeddingInputType = "document" | "query";

export interface EmbeddingProvider {
  readonly id: string;
  readonly model: string;
  /** Maximum number of inputs per request. */
  readonly maxBatchSize: number;
  /** Maximum tokens per single input. */
  readonly maxInputTokens: number;
  /**
   * Returns one vector per input, at the model's native size. The
   * EmbeddingService fits vectors to the database column.
   */
  embed(texts: string[], options?: { signal?: AbortSignal; inputType?: EmbeddingInputType }): Promise<EmbeddingResult>;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  maxOutputTokens?: number;
  /** Ask for a JSON object response. */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatCompletion {
  text: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string | null;
}

export type ChatStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; model: string; usage?: TokenUsage; finishReason?: string | null };

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  /**
   * Context window (prompt + answer, in tokens) when the provider has a small,
   * fixed one — e.g. a local model. The RAG context budget is derived from it.
   */
  readonly contextWindow?: number;
  complete(request: ChatRequest): Promise<ChatCompletion>;
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export type AIErrorKind =
  | "not_configured"
  | "model_unavailable"
  | "quota"
  | "auth"
  | "rate_limit"
  | "unavailable"
  | "context_length"
  | "invalid_request"
  | "unknown";

const USER_MESSAGES: Record<AIErrorKind, string> = {
  not_configured: "AI features aren't configured yet. Add an API key for the AI provider to enable them.",
  model_unavailable:
    "The AI model isn't available on the AI server. Make sure the model is installed (for Ollama: `ollama pull <model>`), then try again.",
  quota:
    "The AI provider account is out of credits or over its quota. Add credits, or switch to free local models (AI_PROVIDER=ollama).",
  auth: "The AI service rejected our credentials. Please check the AI provider configuration.",
  rate_limit: "The AI service is busy right now. Please try again in a moment.",
  unavailable: "We couldn't reach the AI service. Please try again shortly.",
  context_length: "That request was too long for the AI model. Try a shorter question or selection.",
  invalid_request: "The AI service couldn't process this request. Please check the model configuration.",
  unknown: "The AI service returned an unexpected error. Please try again.",
};

export class AIProviderError extends AppError {
  readonly kind: AIErrorKind;
  readonly retryable: boolean;

  constructor(kind: AIErrorKind, options: { message?: string; cause?: unknown } = {}) {
    super(`ai_${kind}`, kind === "context_length" ? 400 : 503, USER_MESSAGES[kind], options);
    this.kind = kind;
    this.retryable = kind === "rate_limit" || kind === "unavailable";
  }
}
