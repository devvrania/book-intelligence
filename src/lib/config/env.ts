import { z } from "zod";

/**
 * Server-side configuration, validated once and memoized.
 *
 * Every tunable of the RAG pipeline lives here so nothing (models, weights,
 * chunk sizes) is hard-coded across the application.
 */

const bool = z.stringbool();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),

  // Database
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  // AI provider: "openai" (hosted) or "ollama" (local models, no API cost)
  AI_PROVIDER: z.enum(["openai", "ollama"]).default("ollama"),

  // 127.0.0.1, not localhost: Node resolves localhost to IPv6 (::1) first, and Ollama listens on IPv4 only
  OLLAMA_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3.1:8b"),
  OLLAMA_UTILITY_MODEL: z.string().optional(),
  OLLAMA_EMBEDDING_MODEL: z.string().default("nomic-embed-text"),
  /** Context window requested from Ollama. Prompts are budgeted to fit inside it. */
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).default(8192),
  OLLAMA_NUM_PREDICT: z.coerce.number().int().positive().default(1200),
  OLLAMA_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  OLLAMA_KEEP_ALIVE: z.string().default("15m"),
  /** For thinking models (qwen3, deepseek-r1…): set false for faster, direct answers. */
  OLLAMA_THINK: bool.optional(),

  /** Optional embedding prefixes (some models need them); known models get sensible defaults. */
  EMBEDDING_DOCUMENT_PREFIX: z.string().optional(),
  EMBEDDING_QUERY_PREFIX: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.url().optional(),
  OPENAI_CHAT_MODEL: z.string().default("gpt-5.4-mini"),
  OPENAI_UTILITY_MODEL: z.string().optional(),
  OPENAI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).optional(),
  OPENAI_TEMPERATURE: z.coerce.number().min(0).max(2).optional(),
  CHAT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4000),
  GENERATE_BOOK_INSIGHTS: bool.default(true),
  OPENAI_EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().min(1).max(2048).default(64),

  // Storage
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  LOCAL_STORAGE_DIR: z.string().default("./storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ENDPOINT: z.url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),

  // Uploads
  MAX_UPLOAD_MB: z.coerce.number().positive().default(100),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(2500),

  // Background processing
  RUN_WORKER_IN_PROCESS: bool.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(1),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(2000),

  // Chunking
  CHUNK_TARGET_TOKENS: z.coerce.number().int().positive().default(700),
  CHUNK_MAX_TOKENS: z.coerce.number().int().positive().default(900),
  CHUNK_MIN_TOKENS: z.coerce.number().int().positive().default(180),
  CHUNK_OVERLAP_TOKENS: z.coerce.number().int().min(0).default(120),

  // Retrieval
  RETRIEVAL_CANDIDATES: z.coerce.number().int().min(1).max(200).default(15),
  RETRIEVAL_TOP_K: z.coerce.number().int().min(1).max(30).default(7),
  RETRIEVAL_SEMANTIC_WEIGHT: z.coerce.number().min(0).default(0.7),
  RETRIEVAL_KEYWORD_WEIGHT: z.coerce.number().min(0).default(0.3),
  /** Unset = a calibrated default for the configured embedding model. */
  RETRIEVAL_MIN_SIMILARITY: z.coerce.number().min(-1).max(1).optional(),
  RETRIEVAL_ITERATIVE_SCAN: bool.default(true),
  /** Token budget for retrieved passages. Unset = 7000 (hosted) or 3000 (local: keeps answers fast). */
  CONTEXT_MAX_TOKENS: z.coerce.number().int().positive().optional(),
  RERANKER: z.enum(["heuristic", "llm"]).default("heuristic"),

  // Rate limits. With no accounts these are shared by everyone using the app.
  RATE_LIMIT_CHAT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_UPLOADS_PER_HOUR: z.coerce.number().int().positive().default(20),
  /** Optional daily caps, e.g. to stay inside a free AI quota on a public deployment. Unset = no daily cap. */
  RATE_LIMIT_CHAT_PER_DAY: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_UPLOADS_PER_DAY: z.coerce.number().int().positive().optional(),
  /** "false" turns off renaming and deleting books (server and UI), for a public deployment. Read at build time too. */
  NEXT_PUBLIC_ALLOW_BOOK_CHANGES: bool.default(true),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  // Treat empty strings ("FOO=") as unset so defaults apply.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined && value !== ""),
  );

  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = parsed.data;
  if (env.CHUNK_MAX_TOKENS < env.CHUNK_TARGET_TOKENS) {
    throw new Error("CHUNK_MAX_TOKENS must be greater than or equal to CHUNK_TARGET_TOKENS");
  }
  if (env.RETRIEVAL_SEMANTIC_WEIGHT + env.RETRIEVAL_KEYWORD_WEIGHT <= 0) {
    throw new Error("At least one of RETRIEVAL_SEMANTIC_WEIGHT / RETRIEVAL_KEYWORD_WEIGHT must be > 0");
  }

  cached = env;
  return env;
}

/** For tests: reset the memoized configuration after mutating process.env. */
export function resetEnvCache() {
  cached = undefined;
}

export interface ChunkingConfig {
  targetTokens: number;
  maxTokens: number;
  minTokens: number;
  overlapTokens: number;
}

export interface RetrievalConfig {
  candidates: number;
  topK: number;
  semanticWeight: number;
  keywordWeight: number;
  /** Undefined until resolved for the embedding model (see defaultMinSimilarity). */
  minSimilarity?: number;
  iterativeScan: boolean;
  contextMaxTokens: number;
}

export function getChunkingConfig(env: Env = getEnv()): ChunkingConfig {
  return {
    targetTokens: env.CHUNK_TARGET_TOKENS,
    maxTokens: env.CHUNK_MAX_TOKENS,
    minTokens: env.CHUNK_MIN_TOKENS,
    overlapTokens: env.CHUNK_OVERLAP_TOKENS,
  };
}

export function getRetrievalConfig(env: Env = getEnv()): RetrievalConfig {
  return {
    candidates: env.RETRIEVAL_CANDIDATES,
    topK: env.RETRIEVAL_TOP_K,
    semanticWeight: env.RETRIEVAL_SEMANTIC_WEIGHT,
    keywordWeight: env.RETRIEVAL_KEYWORD_WEIGHT,
    minSimilarity: env.RETRIEVAL_MIN_SIMILARITY,
    iterativeScan: env.RETRIEVAL_ITERATIVE_SCAN,
    // Local models process prompts far slower than hosted APIs; fewer passages keep answers responsive.
    contextMaxTokens: env.CONTEXT_MAX_TOKENS ?? (env.AI_PROVIDER === "ollama" ? 3000 : 7000),
  };
}
