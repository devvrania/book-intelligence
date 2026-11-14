import { AIProviderError, type EmbeddingInputType, type EmbeddingProvider } from "@/lib/ai";
import { countTokens, truncateToTokens } from "@/lib/documents/tokenizer";
import { logger } from "@/lib/logger";

import { embeddingModelsMatch } from "./model-id";

export interface EmbeddableChunk {
  content: string;
  bookTitle?: string | null;
  chapterTitle?: string | null;
  chapterLabel?: string | null;
  sectionTitle?: string | null;
}

export interface EmbeddingServiceOptions {
  /** Size of the pgvector column. Shorter vectors are zero-padded to fit. */
  columnDimensions: number;
  /** Override the model's document / query prefixes ("none" disables). */
  documentPrefix?: string;
  queryPrefix?: string;
}

/** Stay well under provider request limits (OpenAI: 300k tokens per request). */
const MAX_TOKENS_PER_REQUEST = 120_000;
const QUERY_CACHE_SIZE = 500;

/**
 * Prefixes that asymmetric retrieval models were trained with. Using them
 * noticeably improves local-model retrieval quality.
 */
const KNOWN_PREFIXES: [RegExp, { document: string; query: string }][] = [
  [/^nomic-embed-text/, { document: "search_document: ", query: "search_query: " }],
  [/^(mxbai-embed-large|snowflake-arctic-embed)/, { document: "", query: "Represent this sentence for searching relevant passages: " }],
  [/^qwen3-embedding/, { document: "", query: "Instruct: Given a question about a book, retrieve passages that answer it\nQuery: " }],
  [/^embeddinggemma/, { document: "title: none | text: ", query: "task: search result | query: " }],
];

export function defaultPrefixes(model: string): { document: string; query: string } {
  const name = model.split("/").pop() ?? model;
  return KNOWN_PREFIXES.find(([pattern]) => pattern.test(name))?.[1] ?? { document: "", query: "" };
}

/**
 * Embedding generation on top of an EmbeddingProvider:
 *  - metadata enrichment ("contextual chunk headers") so a passage carries
 *    its book/chapter/section context into vector space
 *  - model-specific document/query prefixes
 *  - batching by both input count and token budget
 *  - fitting vectors to the database column: shorter vectors (e.g. 768-dim
 *    local models) are zero-padded, which leaves cosine similarity unchanged
 *  - an LRU cache for query embeddings (suggested prompts repeat a lot)
 */
export class EmbeddingService {
  private readonly queryCache = new Map<string, number[]>();
  private readonly prefixes: { document: string; query: string };

  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly options: EmbeddingServiceOptions,
  ) {
    const defaults = defaultPrefixes(provider.model);
    const pick = (override: string | undefined, fallback: string) =>
      override === undefined ? fallback : override === "none" ? "" : override;
    this.prefixes = {
      document: pick(options.documentPrefix, defaults.document),
      query: pick(options.queryPrefix, defaults.query),
    };
  }

  /** Identifies the vector space: books embedded with another model can't be queried with this one. */
  get model() {
    return `${this.provider.id}:${this.provider.model.replace(/:latest$/, "")}`;
  }

  /** Whether vectors produced by `storedModel` can be compared with this service's queries. */
  isCompatibleWith(storedModel: string | null | undefined): boolean {
    return embeddingModelsMatch(storedModel, this.model);
  }

  /** The text actually embedded for a chunk. The stored `content` stays untouched. */
  static enrich(chunk: EmbeddableChunk): string {
    const header = [
      chunk.bookTitle ? `Book: ${chunk.bookTitle}` : null,
      chunk.chapterTitle || chunk.chapterLabel
        ? `Chapter: ${[chunk.chapterLabel, chunk.chapterTitle].filter((v, i, a) => v && a.indexOf(v) === i).join(" — ")}`
        : null,
      chunk.sectionTitle ? `Section: ${chunk.sectionTitle}` : null,
    ].filter(Boolean);
    return header.length ? `${header.join("\n")}\n\n${chunk.content}` : chunk.content;
  }

  /** Zero-pad (or reject) a vector so it matches the database column. */
  private fit(vector: number[]): number[] {
    const { columnDimensions } = this.options;
    if (vector.length === columnDimensions) return vector;
    if (vector.length > columnDimensions) {
      throw new AIProviderError("invalid_request", {
        message: `Embedding model "${this.provider.model}" returns ${vector.length} dimensions, but the database column holds ${columnDimensions}. Use a model with at most ${columnDimensions} dimensions.`,
      });
    }
    return vector.concat(new Array<number>(columnDimensions - vector.length).fill(0));
  }

  private prepare(text: string, inputType: EmbeddingInputType) {
    const prefix = inputType === "query" ? this.prefixes.query : this.prefixes.document;
    return prefix + truncateToTokens(text, this.provider.maxInputTokens - 16 - countTokens(prefix));
  }

  async embedChunks(chunks: EmbeddableChunk[], options: { signal?: AbortSignal } = {}): Promise<number[][]> {
    const inputs = chunks.map((chunk) => this.prepare(EmbeddingService.enrich(chunk), "document"));
    const results: number[][] = [];

    let batch: string[] = [];
    let batchTokens = 0;
    const flush = async () => {
      if (batch.length === 0) return;
      const started = performance.now();
      const { embeddings, usage } = await this.provider.embed(batch, { ...options, inputType: "document" });
      logger.debug("embeddings.batch", {
        model: this.model,
        inputs: batch.length,
        promptTokens: usage?.promptTokens,
        durationMs: Math.round(performance.now() - started),
      });
      results.push(...embeddings.map((vector) => this.fit(vector)));
      batch = [];
      batchTokens = 0;
    };

    for (const input of inputs) {
      const tokens = countTokens(input);
      if (batch.length >= this.provider.maxBatchSize || batchTokens + tokens > MAX_TOKENS_PER_REQUEST) await flush();
      batch.push(input);
      batchTokens += tokens;
    }
    await flush();
    return results;
  }

  async embedQuery(query: string, options: { signal?: AbortSignal } = {}): Promise<number[]> {
    const key = `${this.model}\u0000${query.trim().toLowerCase()}`;
    const cached = this.queryCache.get(key);
    if (cached) {
      // Refresh recency.
      this.queryCache.delete(key);
      this.queryCache.set(key, cached);
      return cached;
    }
    const {
      embeddings: [embedding],
    } = await this.provider.embed([this.prepare(query, "query")], { ...options, inputType: "query" });
    const fitted = this.fit(embedding);
    this.queryCache.set(key, fitted);
    if (this.queryCache.size > QUERY_CACHE_SIZE) {
      this.queryCache.delete(this.queryCache.keys().next().value!);
    }
    return fitted;
  }
}
