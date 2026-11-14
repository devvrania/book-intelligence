import { countTokens } from "@/lib/documents/tokenizer";
import { logger } from "@/lib/logger";
import type { TokenUsage } from "@/types/domain";

import {
  AIProviderError,
  type ChatCompletion,
  type ChatMessage,
  type ChatProvider,
  type ChatRequest,
  type ChatStreamEvent,
  type EmbeddingProvider,
  type EmbeddingResult,
} from "./types";

/**
 * Local models through Ollama's native API (no API cost).
 *
 * The native API is used rather than Ollama's OpenAI-compatible endpoint
 * because only the native API lets each request set the context window
 * (`num_ctx`). Ollama otherwise uses a small default and silently drops the
 * *start* of longer prompts — which is where the system prompt (grounding and
 * prompt-injection rules) lives. Prompts are budgeted to always fit.
 */

export interface OllamaConnection {
  baseUrl: string;
  keepAlive?: string;
}

export interface OllamaChatOptions extends OllamaConnection {
  numCtx: number;
  numPredict: number;
  temperature?: number;
  think?: boolean;
}

async function ollamaRequest(
  connection: OllamaConnection,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(new URL(path, connection.baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new AIProviderError("unavailable", {
      cause: error,
      message: `Cannot reach Ollama at ${connection.baseUrl} — is it running? (${(error as Error).message})`,
    });
  }
  if (!response.ok) throw await toOllamaError(response);
  return response;
}

export async function toOllamaError(response: Response): Promise<AIProviderError> {
  const raw = await response.text().catch(() => "");
  let message = raw;
  try {
    message = (JSON.parse(raw) as { error?: string }).error ?? raw;
  } catch {
    // not JSON
  }
  return classifyOllamaError(response.status, message);
}

export function classifyOllamaError(status: number, message: string): AIProviderError {
  const detail = `Ollama ${status}: ${message}`;
  if (status === 404 || /not found|try pulling|pull the model/i.test(message)) {
    return new AIProviderError("model_unavailable", { message: detail });
  }
  if (/more system memory|out of memory|insufficient memory/i.test(message)) {
    return new AIProviderError("model_unavailable", { message: detail });
  }
  if (/context (length|window)|too long|exceeds/i.test(message)) return new AIProviderError("context_length", { message: detail });
  if (status >= 500) return new AIProviderError("unavailable", { message: detail });
  if (status === 400) return new AIProviderError("invalid_request", { message: detail });
  return new AIProviderError("unknown", { message: detail });
}

/* ------------------------------- Embeddings ------------------------------- */

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly id = "ollama";
  readonly maxBatchSize: number;
  /** Conservative: many local embedding models have a 2,048-token window. Ollama also truncates. */
  readonly maxInputTokens = 2000;

  constructor(
    private readonly connection: OllamaConnection,
    readonly model: string,
    batchSize = 32,
  ) {
    this.maxBatchSize = batchSize;
  }

  async embed(texts: string[], options: { signal?: AbortSignal } = {}): Promise<EmbeddingResult> {
    if (texts.length === 0) return { embeddings: [] };
    const response = await ollamaRequest(
      this.connection,
      "/api/embed",
      { model: this.model, input: texts, truncate: true, keep_alive: this.connection.keepAlive },
      options.signal,
    );
    const data = (await response.json()) as { embeddings?: number[][]; prompt_eval_count?: number };
    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new AIProviderError("invalid_request", {
        message: `Ollama returned ${data.embeddings?.length ?? 0} embeddings for ${texts.length} inputs (is "${this.model}" an embedding model?)`,
      });
    }
    return { embeddings: data.embeddings, usage: { promptTokens: data.prompt_eval_count } };
  }
}

/* ---------------------------------- Chat ---------------------------------- */

/**
 * Token estimate for non-OpenAI tokenizers: the cl100k count plus a safety
 * margin (Llama/Qwen/Gemma tokenizers are in the same ballpark).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(countTokens(text) * 1.15) + 4;
}

/**
 * Make a conversation fit the context budget by dropping the oldest turns.
 * The system prompt and the final user turn (which holds the book context and
 * the question) are always kept.
 */
export function fitToContext(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
  const cost = messages.map((message) => estimateTokens(message.content));
  let total = cost.reduce((sum, value) => sum + value, 0);
  if (total <= budgetTokens) return messages;

  const kept = messages.map((message, index) => ({ message, tokens: cost[index] }));
  let dropped = 0;
  while (total > budgetTokens && kept.length > 2) {
    const [removed] = kept.splice(1, 1);
    total -= removed.tokens;
    dropped++;
  }
  if (total > budgetTokens) {
    throw new AIProviderError("context_length", {
      message: `Prompt needs ~${total} tokens but only ${budgetTokens} fit in the model's context window`,
    });
  }
  logger.warn("ollama.history_trimmed", { droppedMessages: dropped, promptTokens: total, budgetTokens });
  return kept.map((entry) => entry.message);
}

/** Removes `<think>…</think>` blocks from streamed text (models that inline their reasoning). */
export class ThinkTagFilter {
  private inside = false;
  private buffer = "";
  private started = false;

  push(text: string): string {
    this.buffer += text;
    let out = "";
    for (;;) {
      const tag = this.inside ? "</think>" : "<think>";
      const index = this.buffer.indexOf(tag);
      if (index === -1) {
        const keep = partialSuffixLength(this.buffer, tag);
        if (!this.inside) out += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        break;
      }
      if (!this.inside) out += this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + tag.length);
      this.inside = !this.inside;
    }
    // Drop whitespace left at the very start by a removed reasoning block.
    if (!this.started) {
      out = out.replace(/^\s+/, "");
      if (out) this.started = true;
    }
    return out;
  }

  flush(): string {
    const rest = this.inside ? "" : this.buffer;
    this.buffer = "";
    return this.started ? rest : rest.trimStart();
  }
}

function partialSuffixLength(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length--) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

export function stripThinking(text: string): string {
  const filter = new ThinkTagFilter();
  return (filter.push(text) + filter.flush()).trim();
}

interface OllamaChatChunk {
  model?: string;
  message?: { role?: string; content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

function toUsage(chunk: OllamaChatChunk): TokenUsage | undefined {
  if (chunk.prompt_eval_count === undefined && chunk.eval_count === undefined) return undefined;
  return {
    promptTokens: chunk.prompt_eval_count,
    completionTokens: chunk.eval_count,
    totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
  };
}

export class OllamaChatProvider implements ChatProvider {
  readonly id = "ollama";
  readonly contextWindow: number;

  constructor(
    private readonly options: OllamaChatOptions,
    readonly model: string,
  ) {
    this.contextWindow = options.numCtx;
  }

  private body(request: ChatRequest, stream: boolean) {
    const numPredict = Math.min(request.maxOutputTokens ?? this.options.numPredict, this.options.numPredict);
    return {
      model: this.model,
      messages: fitToContext(request.messages, this.options.numCtx - numPredict),
      stream,
      keep_alive: this.options.keepAlive,
      ...(request.json ? { format: "json" } : {}),
      ...(this.options.think !== undefined ? { think: this.options.think } : {}),
      options: {
        num_ctx: this.options.numCtx,
        num_predict: numPredict,
        ...(this.options.temperature !== undefined ? { temperature: this.options.temperature } : {}),
      },
    };
  }

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    const response = await ollamaRequest(this.options, "/api/chat", this.body(request, false), request.signal);
    const data = (await response.json()) as OllamaChatChunk;
    if (data.error) throw classifyOllamaError(500, data.error);
    return {
      text: stripThinking(data.message?.content ?? ""),
      model: data.model ?? this.model,
      usage: toUsage(data),
      finishReason: data.done_reason ?? null,
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    const response = await ollamaRequest(this.options, "/api/chat", this.body(request, true), request.signal);
    if (!response.body) throw new AIProviderError("unavailable", { message: "Ollama returned an empty stream" });

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const thinking = new ThinkTagFilter();
    let buffer = "";
    let final: OllamaChatChunk | null = null;

    const handle = (line: string): ChatStreamEvent | null => {
      const chunk = JSON.parse(line) as OllamaChatChunk;
      if (chunk.error) throw classifyOllamaError(500, chunk.error);
      if (chunk.done) final = chunk;
      const text = thinking.push(chunk.message?.content ?? "");
      return text ? { type: "delta", text } : null;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          const event = line ? handle(line) : null;
          if (event) yield event;
          newline = buffer.indexOf("\n");
        }
      }
      if (buffer.trim()) {
        const event = handle(buffer.trim());
        if (event) yield event;
      }
    } catch (error) {
      if (error instanceof AIProviderError || request.signal?.aborted) throw error;
      throw new AIProviderError("unavailable", { cause: error, message: `Ollama stream failed: ${(error as Error).message}` });
    }

    const rest = thinking.flush();
    if (rest) yield { type: "delta", text: rest };
    const last = final as OllamaChatChunk | null;
    yield { type: "done", model: last?.model ?? this.model, usage: last ? toUsage(last) : undefined, finishReason: last?.done_reason ?? null };
  }
}
