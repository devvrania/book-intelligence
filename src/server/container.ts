import { createAIProviders, maxOutputTokens, type AIProviders } from "@/lib/ai";
import { getChunkingConfig, getEnv, getRetrievalConfig, type Env } from "@/lib/config/env";
import { getDb, type Database } from "@/lib/db/client";
import { VECTOR_DIMENSIONS } from "@/lib/db/schema";
import { ChunkingService } from "@/lib/documents/chunking-service";
import { DocumentProcessor } from "@/lib/documents/document-processor";
import { EmbeddingService } from "@/lib/embeddings/embedding-service";
import { defaultMinSimilarity } from "@/lib/embeddings/model-id";
import { PostgresJobQueue, PostgresJobWorker, type WorkerOptions } from "@/lib/jobs/postgres-queue";
import type { JobQueue } from "@/lib/jobs/types";
import { RAGService } from "@/lib/rag/rag-service";
import { PostgresRateLimiter, type RateLimiter } from "@/lib/rate-limit";
import { QueryRewriter } from "@/lib/retrieval/query-rewriter";
import { HeuristicReranker, LLMReranker, type Reranker } from "@/lib/retrieval/reranking-service";
import { RetrievalService } from "@/lib/retrieval/retrieval-service";
import { createStorageProvider, type StorageProvider } from "@/lib/storage";
import { BookRepository } from "@/server/repositories/book-repository";
import { ConversationRepository } from "@/server/repositories/conversation-repository";
import { DocumentRepository } from "@/server/repositories/document-repository";
import { BookService } from "@/server/services/book-service";
import { ChatService } from "@/server/services/chat-service";
import { ConversationService } from "@/server/services/conversation-service";
import { IngestionService } from "@/server/services/ingestion-service";
import { InsightsService } from "@/server/services/insights-service";

/**
 * Tokens reserved in the prompt for everything except retrieved passages:
 * system prompt, recent conversation, the question and guidance.
 */
const PROMPT_OVERHEAD_TOKENS = 2200;

export interface ServiceOverrides {
  env?: Env;
  db?: Database;
  storage?: StorageProvider;
  ai?: AIProviders;
  queue?: JobQueue;
  rateLimiter?: RateLimiter;
  reranker?: Reranker;
}

/**
 * Composition root: the only place that knows which concrete implementations
 * are in use. Everything else depends on constructor-injected interfaces,
 * which keeps services independently testable (tests pass PGlite + fakes).
 */
export function createServices(overrides: ServiceOverrides = {}) {
  const env = overrides.env ?? getEnv();
  const db = overrides.db ?? getDb();
  const storage = overrides.storage ?? createStorageProvider(env);
  const ai = overrides.ai ?? createAIProviders(env);
  const queue = overrides.queue ?? new PostgresJobQueue(db);
  const rateLimiter = overrides.rateLimiter ?? new PostgresRateLimiter(db);
  const answerTokens = maxOutputTokens(env);

  // Models with a small fixed context window (local models) get a passage
  // budget that always fits: window − answer − prompt overhead.
  const baseRetrieval = getRetrievalConfig(env);
  const embeddings = new EmbeddingService(ai.embeddings, {
    columnDimensions: VECTOR_DIMENSIONS,
    documentPrefix: env.EMBEDDING_DOCUMENT_PREFIX,
    queryPrefix: env.EMBEDDING_QUERY_PREFIX,
    maxTokensPerRequest: env.EMBEDDING_MAX_TOKENS_PER_REQUEST,
    maxRateLimitWaits: env.EMBEDDING_RATE_LIMIT_MAX_WAITS,
  });
  const retrievalConfig = {
    ...baseRetrieval,
    minSimilarity: baseRetrieval.minSimilarity ?? defaultMinSimilarity(embeddings.model),
    contextMaxTokens: ai.chat.contextWindow
      ? Math.max(
          1200,
          Math.min(baseRetrieval.contextMaxTokens, ai.chat.contextWindow - answerTokens - PROMPT_OVERHEAD_TOKENS),
        )
      : baseRetrieval.contextMaxTokens,
  };

  const repositories = {
    books: new BookRepository(db),
    documents: new DocumentRepository(db),
    conversations: new ConversationRepository(db),
  };

  const utility = ai.utility.id === "unconfigured" ? null : ai.utility;
  const retrieval = new RetrievalService(db, embeddings, retrievalConfig);
  const reranker =
    overrides.reranker ?? (env.RERANKER === "llm" && utility ? new LLMReranker(utility) : new HeuristicReranker());
  const rag = new RAGService(ai.chat, { maxOutputTokens: answerTokens });

  const ingestion = new IngestionService({
    ...repositories,
    storage,
    embeddings,
    processor: new DocumentProcessor(),
    chunking: new ChunkingService(getChunkingConfig(env)),
    insights: new InsightsService(env.GENERATE_BOOK_INSIGHTS ? utility : null),
    embeddingBatchSize: env.EMBEDDING_BATCH_SIZE,
    maxPages: env.MAX_PDF_PAGES,
  });

  const books = new BookService({
    ...repositories,
    storage,
    queue,
    maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
  });
  const conversations = new ConversationService(repositories);
  const chat = new ChatService({
    ...repositories,
    embeddings,
    retrieval,
    reranker,
    rag,
    rewriter: new QueryRewriter(utility),
    rateLimiter,
    retrievalConfig,
    chatRateLimitPerMinute: env.RATE_LIMIT_CHAT_PER_MINUTE,
    chatRateLimitPerDay: env.RATE_LIMIT_CHAT_PER_DAY,
  });
  const createWorker = (options: WorkerOptions = {}) =>
    new PostgresJobWorker(db, { ingest_book: ingestion }, {
      concurrency: env.WORKER_CONCURRENCY,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      ...options,
    });

  return {
    env,
    db,
    storage,
    ai,
    queue,
    rateLimiter,
    repositories,
    embeddings,
    retrieval,
    reranker,
    rag,
    ingestion,
    books,
    conversations,
    chat,
    createWorker,
    retrievalConfig,
    aiConfigured: ai.chat.id !== "unconfigured",
  };
}

export type Services = ReturnType<typeof createServices>;

const globalForServices = globalThis as unknown as { __bookIntelligenceServices?: Services };

/** Process-wide singleton (survives dev hot reloads). */
export function getServices(): Services {
  globalForServices.__bookIntelligenceServices ??= createServices();
  return globalForServices.__bookIntelligenceServices;
}
