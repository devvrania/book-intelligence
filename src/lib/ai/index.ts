import { getEnv, type Env } from "@/lib/config/env";
import { VECTOR_DIMENSIONS } from "@/lib/db/schema";

import { OllamaChatProvider, OllamaEmbeddingProvider } from "./ollama";
import { createOpenAIClient, OpenAIChatProvider, OpenAIEmbeddingProvider } from "./openai";
import {
  AIProviderError,
  type ChatProvider,
  type EmbeddingProvider,
} from "./types";

export * from "./types";

export interface AIProviders {
  embeddings: EmbeddingProvider;
  /** Model used for grounded answers. */
  chat: ChatProvider;
  /** Model used for small internal tasks (query rewriting, reranking, insights). */
  utility: ChatProvider;
}

/** Placeholder used when no API key is configured: fails clearly, never silently. */
class UnconfiguredEmbeddingProvider implements EmbeddingProvider {
  readonly id = "unconfigured";
  readonly maxBatchSize = 1;
  readonly maxInputTokens = 8191;
  constructor(readonly model: string) {}
  async embed(): Promise<never> {
    throw new AIProviderError("not_configured", { message: "OPENAI_API_KEY is not set" });
  }
}

class UnconfiguredChatProvider implements ChatProvider {
  readonly id = "unconfigured";
  constructor(readonly model: string) {}
  async complete(): Promise<never> {
    throw new AIProviderError("not_configured", { message: "OPENAI_API_KEY is not set" });
  }
  async *stream(): AsyncIterable<never> {
    throw new AIProviderError("not_configured", { message: "OPENAI_API_KEY is not set" });
  }
}

export function createAIProviders(env: Env = getEnv()): AIProviders {
  if (env.EMBEDDING_DIMENSIONS !== VECTOR_DIMENSIONS) {
    throw new Error(
      `EMBEDDING_DIMENSIONS (${env.EMBEDDING_DIMENSIONS}) must equal the database vector dimension (${VECTOR_DIMENSIONS}). ` +
        "Change VECTOR_DIMENSIONS in src/lib/db/schema.ts and generate a migration to use a different size.",
    );
  }

  switch (env.AI_PROVIDER) {
    case "openai": {
      if (!env.OPENAI_API_KEY) {
        return {
          embeddings: new UnconfiguredEmbeddingProvider(env.OPENAI_EMBEDDING_MODEL),
          chat: new UnconfiguredChatProvider(env.OPENAI_CHAT_MODEL),
          utility: new UnconfiguredChatProvider(env.OPENAI_UTILITY_MODEL ?? env.OPENAI_CHAT_MODEL),
        };
      }
      const client = createOpenAIClient({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL });
      const chatOptions = { reasoningEffort: env.OPENAI_REASONING_EFFORT, temperature: env.OPENAI_TEMPERATURE };
      return {
        embeddings: new OpenAIEmbeddingProvider(
          client,
          env.OPENAI_EMBEDDING_MODEL,
          env.EMBEDDING_DIMENSIONS,
          env.EMBEDDING_BATCH_SIZE,
        ),
        chat: new OpenAIChatProvider(client, env.OPENAI_CHAT_MODEL, chatOptions),
        utility: new OpenAIChatProvider(client, env.OPENAI_UTILITY_MODEL ?? env.OPENAI_CHAT_MODEL, chatOptions),
      };
    }
    case "ollama": {
      // Local models: no API key, no per-token cost.
      const connection = { baseUrl: env.OLLAMA_BASE_URL, keepAlive: env.OLLAMA_KEEP_ALIVE };
      const chatOptions = {
        ...connection,
        numCtx: env.OLLAMA_NUM_CTX,
        numPredict: env.OLLAMA_NUM_PREDICT,
        temperature: env.OLLAMA_TEMPERATURE,
        think: env.OLLAMA_THINK,
      };
      return {
        embeddings: new OllamaEmbeddingProvider(connection, env.OLLAMA_EMBEDDING_MODEL, env.EMBEDDING_BATCH_SIZE),
        chat: new OllamaChatProvider(chatOptions, env.OLLAMA_CHAT_MODEL),
        utility: new OllamaChatProvider(chatOptions, env.OLLAMA_UTILITY_MODEL ?? env.OLLAMA_CHAT_MODEL),
      };
    }
  }
}

/** Max answer length requested from the configured chat model. */
export function maxOutputTokens(env: Env = getEnv()): number {
  return env.AI_PROVIDER === "ollama" ? env.OLLAMA_NUM_PREDICT : env.CHAT_MAX_OUTPUT_TOKENS;
}
