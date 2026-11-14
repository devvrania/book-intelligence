# Book Intelligence — Architecture

This document explains how the system is put together and why. It covers the moving parts, the data model, both halves of the RAG pipeline (ingestion and answering), and the decisions behind them.

## 1. Overview

```
┌──────────────────────────── Next.js 16 (App Router, Node runtime) ──────────────────────────────┐
│                                                                                                 │
│  UI (React 19, Tailwind v4, shadcn/ui, Framer Motion, TanStack Query)                           │
│   / (library)  ·  /books/[id] (Ask AI)  ·  /books/[id]/read (Reader)                            │
│                │  fetch / NDJSON stream                                                         │
│  Route handlers (/api/**)  ── thin: validation (zod), origin check, error mapping               │
│                │                                                                                │
│  Services (src/server/services)  BookService · ChatService · ConversationService                │
│                │                 IngestionService · InsightsService                             │
│  Domain libs (src/lib)            documents/ · embeddings/ · retrieval/ · rag/ · ai/ · storage/ │
│                │                 jobs/ · library/ · rate-limit                                  │
│  Repositories (src/server/repositories) ── all SQL lives here or in retrieval                   │
│                │                                                                                │
│  Embedded job worker (instrumentation.ts) ── or a separate `npm run worker` process             │
└────────────────┬──────────────────────────────────────┬──────────────────────────┬──────────────┘
                 │                                      │                          │
      PostgreSQL 17 + pgvector               Object storage                 AI provider
      relational data, vectors (HNSW),      (local FS | S3 / R2 /         Ollama (local, default)
      full-text (GIN), job queue,            Supabase)                     or OpenAI / compatible API
      rate limits
```

The deployable is one Next.js app plus PostgreSQL, object storage, and an AI provider. By default the provider is a local Ollama server, so there's no API cost and no book text leaves the machine. There are no extra services: the job queue, rate limiting, vectors and full-text search all live in Postgres. Each piece sits behind an interface, so it can move out later (BullMQ, Redis, a hosted reranker) without touching the business logic.

### Folder structure

```
src/
  app/
    (dashboard)/          library (home page), book workspace, reader
    api/                  route handlers — thin adapters over services
  components/
    ui/                   shadcn/ui primitives
    books/ chat/ reader/ library/ layout/ brand/
  features/               client-side data layer (API clients, TanStack Query hooks, chat stream)
  lib/
    config/env.ts         validated configuration (every RAG knob is an env var)
    db/                   Drizzle schema + client
    ai/                   provider interfaces + Ollama and OpenAI-compatible implementations
    documents/            PDF extraction, cleaning, structure detection, chunking (pure, no I/O)
    embeddings/           EmbeddingService (enrichment, batching, query cache)
    retrieval/            query analysis, hybrid retrieval, fusion, reranking, follow-up rewriting
    rag/                  prompts, context builder, citation validation, RAGService
    jobs/                 queue/worker contracts + Postgres implementation
    storage/              StorageProvider + local and S3 implementations
    library/              feature flags (there are no accounts)
  server/
    services/             business logic
    repositories/         data access
    http/                 route-handler wrapper (origin check, error mapping)
    container.ts          composition root (dependency injection)
  types/                  shared domain + API types
scripts/                  migrate, seed, standalone worker
seed/                     public-domain seed texts + PDF typesetter
drizzle/                  SQL migrations
tests/                    unit + integration (PGlite)
```

The layers depend in one direction: `app/api` → `server/services` → `lib/*` + `server/repositories` → `lib/db`. Everything is wired in `server/container.ts` and injected through constructors. That is what lets the tests run the real services against an in-memory Postgres with fake AI providers.

## 2. Data model

PostgreSQL holds both the relational data and the vectors. The schema is in `src/lib/db/schema.ts` and the migrations in `drizzle/`.

| Table | Purpose | Notable columns / constraints |
| --- | --- | --- |
| `books` | One uploaded book | `status` (`UPLOADING → PROCESSING → READY / FAILED`) plus a fine-grained `processing_stage` and `processing_progress` (what the UI renders). `processing_error` holds a user-facing message only. `file_key`/`cover_key` are storage keys, never public URLs. `embedding_model` records which model produced the vectors. `insights` (JSONB) holds keywords, recurring names and suggested questions |
| `chapters` | Detected chapters | `chapter_number` = position (unique per book). `label` + `label_number` = the book's own numbering ("Chapter IV" → 4), so "chapter 4" resolves correctly even with front matter. `start_page`, `end_page` |
| `document_pages` | Cleaned text per physical page | `(book_id, page_number)` unique. `page_label` (printed number when the PDF defines one). `blocks` JSONB (headings / paragraphs / scene breaks, each tagged with chapter and section). Generated `search_vector` + GIN index (from the removed in-book search; unused by the current UI) |
| `document_chunks` | Retrieval units | `(book_id, chunk_index)` unique. `chapter_id`, `page_id`, `page_start/page_end`, `section_title`, `token_count`, `metadata` JSONB. `embedding vector(1536)` with an **HNSW (cosine)** index. Generated, weighted `search_vector` (chapter/section titles weight A, body weight B) with a **GIN** index |
| `conversations` | The shared thread about one book | `(book_id, last_message_at desc)` index |
| `messages` | User and assistant turns | `role`, `status` (`complete`/`error`), `metadata` JSONB (query type, rewritten query, model, token usage, latencies) |
| `message_sources` | Exactly which chunks were shown to the model for an answer | `rank` (= the `[S#]` label), `similarity_score`, `keyword_score`, final `score`, `cited` (did the answer actually cite it). `snapshot` JSONB stores the passage as shown. `chunk_id` FK `ON DELETE SET NULL` |
| `processing_jobs` | Durable job queue | `status`, `attempts`/`max_attempts`, `run_at`, `locked_at`/`locked_by`. Partial unique index `(book_id, type) WHERE status IN ('queued','running')`, so a book can have only one active job |
| `rate_limits` | Fixed-window counters shared by all instances | `key` primary key |

Design notes:

- **No accounts, no personal data.** There are no user tables or owner columns; the library is shared. Lookups are indexed by their access path: `books(updated_at)`, `books(last_opened_at)`, `conversations(book_id, last_message_at)`, `messages(conversation_id, created_at)`, plus `book_id`/`chapter_id` on pages and chunks.
- **Cascades follow the book.** Deleting a book removes its chapters, pages, chunks, conversations, messages and jobs, and its files are removed from storage.
- **Citations outlive reprocessing.** Reprocessing a book replaces its chunk rows. `message_sources.snapshot` keeps a faithful record of what was cited, and the FK is set to null instead of deleting the citation.
- **Generated `tsvector` columns** keep full-text indexes in sync with zero application code.

## 3. Ingestion pipeline

```
Upload → store original → Book(UPLOADING→PROCESSING) → enqueue job
  ↓ worker
EXTRACTING           pdf.js (unpdf): positioned text lines per page, outline (bookmarks), page labels, metadata
DETECTING_STRUCTURE  clean (headers/footers/page numbers, hyphenation, paragraphs) → chapters & sections
CHUNKING             hierarchical, structure-aware chunks (500–900 tokens, sentence-aligned overlap)
EMBEDDING            contextual headers + batched embeddings → pgvector (resumable)
INDEXING             ANALYZE + per-book insights (keywords, names, suggested questions)
→ READY
```

**Upload (two requests).** `POST /api/books` validates the name, extension and size, then creates the Book immediately (`UPLOADING`). `PUT /api/books/:id/upload` streams the raw bytes into memory with a hard size cap, verifies the `%PDF-` signature, stores the file under a server-generated key (`books/<bid>/original.pdf`), sets `PROCESSING/QUEUED`, and enqueues the job. Using raw-body XHR gives the browser real upload progress. No processing happens inside an HTTP request.

**Extraction** (`lib/documents/pdf-extractor.ts`) runs one page at a time and releases each page afterwards, so memory stays flat on long books. Text items become lines, using baseline position, font size and the gaps between items. Rotated text (watermarks) and duplicated glyph runs ("fake bold") are dropped. The extractor also reads the outline, so chapters can come from bookmarks, and the printed page labels, so citations can say "page xii".

**Cleaning** (`text-cleaner.ts`) only removes layout artifacts and never rewrites the author's words:

- **Running headers and footers.** A line in the top or bottom 10% of the page is removed when its normalized signature repeats densely across pages. Alternating odd/even headers and per-chapter headers are handled by a density test, and by matching small header lines against headings found elsewhere in the book.
- **Page numbers** in the edge zones are removed, in forms like `12`, `xii`, `Page 3 of 9` and `– 4 –`.
- **Paragraphs** are rebuilt from vertical gaps, first-line indentation, short final lines and font changes. Hyphenated line breaks are repaired, and NFKC artifacts such as ligatures and soft hyphens are normalized.
- **Paragraphs split by a page break** are flagged as continuations. In books with indented paragraphs, "the next page starts flush-left" is the signal.

**Structure** (`structure-detector.ts`):

- **Title and author** come from PDF metadata when it is meaningful (strings like "Microsoft Word – x.docx" are rejected). Otherwise the detector uses the largest heading and a "by …" line, and finally the filename.
- **Chapters** come from the first source that works:
  1. the PDF outline;
  2. labeled headings such as "Chapter IV", "PART TWO" or "Letter 3", where a following heading supplies the title and contents pages are ignored;
  3. the largest recurring heading size.
- **Sections** are the lower-level headings within a chapter.
- **Annotation.** Every block is tagged with its chapter and section, and that annotation is stored in `document_pages.blocks`.

**Chunking** (`chunking-service.ts`) is hierarchical. Boundaries are respected in priority order:

1. Chapters and sections are hard boundaries. Scene breaks (`* * *`) also count. A section too small to stand alone is merged with a neighbor in the same chapter, and its heading is kept inline.
2. Paragraphs: chunks are packed from whole paragraphs towards the target size (default 700 tokens, max 900, min 180).
3. Sentences: a paragraph is split only when it alone would exceed the max. The sentence splitter is ICU-based and repaired for "Mr." and initials.
4. Tokens: a last resort for pathological sentences.

Consecutive chunks in the same section share a sentence-aligned overlap of about 120 tokens. `metadata.overlapChars` records it so excerpts and the reader can skip the repeated text. Token counts use `cl100k_base`, the tokenizer of the embedding model. Every size is configurable.

**Embedding** (`embedding-service.ts`):

- **Contextual header.** Each chunk is embedded with a header line ("Book · Chapter · Section"), so passages that never name their topic still land near queries about it. The stored `content` is untouched.
- **Batching** respects both the provider's input-count limit and a token budget per request.
- **Resumable.** The loop embeds `WHERE embedding IS NULL` in batches, so a retry continues where it stopped.
- **Model tracking.** The embedding model is recorded on the book. Asking questions with a different configured model is refused with a "reprocess this book" message, instead of silently comparing incompatible vectors.

**Checkpointing.** Pages, chunks and embeddings are each persisted before the next stage. When a transient failure is retried, the job resumes and doesn't re-pay for embeddings. Reprocessing clears derived data and starts over.

**Covers.** Page 1 is rendered with `@napi-rs/canvas` only when it actually paints an image, which is what a real cover does. Text-only title pages fall back to the UI's generated covers.

## 4. Answering pipeline (RAG)

```
question ─► query understanding ─► (follow-up rewrite) ─► hybrid retrieval ─► rerank ─► context ─► LLM (stream) ─► citation validation ─► persist
```

### 4.1 Query understanding (`retrieval/query-analyzer.ts`)

This step is deterministic and costs nothing: no extra model call.

- **Type:** factual, conceptual, summarization, comparison, character, theme, quote, chapter or broad.
- **Chapter references:** "chapter 3", "chapters 2 and 7", "chapters 1–3", "chapter III", "chapter one", "the last chapter". They are resolved against the book's own labels first, then against chapter positions.
- **Soft chapter mentions:** a chapter title appearing in the question is treated as a hint, not a filter.
- **Other signals:** page references (mapped to printed labels when they exist), quoted phrases, keywords, and whether the question looks like a follow-up.

### 4.2 Follow-ups (`retrieval/query-rewriter.ts`)

A follow-up such as "why did she refuse him?" is rewritten by the utility model into a standalone search query. Without a model, retrieval is anchored on the previous question instead. Only *retrieval* uses the rewrite. The model answers the reader's original words, with the resolved meaning given as a hint.

### 4.3 Hybrid retrieval (`retrieval/retrieval-service.ts`)

Retrieval runs in two steps.

**Recall.** Several cheap queries return candidate ids only:

| Recall query | Source |
| --- | --- |
| Semantic KNN | pgvector `<=>` cosine distance on the HNSW index. Runs with `SET LOCAL hnsw.iterative_scan = relaxed_order`, so book filters can't starve results (pgvector ≥ 0.8) |
| Keyword | `ts_rank_cd` over an OR-ed `plainto_tsquery`, so passages matching more of the question's terms rank higher |
| Exact phrase | `phraseto_tsquery`, for quoted phrases |
| Chapter coverage | Evenly spaced chunks across a chapter, for summaries |
| Best per chapter | The most similar chunk in each chapter, for book-level questions |
| Page anchors | Chunks covering a page sent with the question (the API supports it; the current UI doesn't send one) |

All recall queries are scoped to one book and can apply metadata filters (chapter, page range, section). The question type picks the strategy:

- **Comparisons** across chapters retrieve per chapter, so both sides get evidence.
- **"Summarize chapter 3"** filters to that chapter and adds coverage.
- **"What is this book about?"** adds one representative passage per chapter.

**Scoring.** A single query computes both scores for every candidate, and they are fused:

```
finalScore = semanticWeight × semantic/maxSemantic + keywordWeight × keyword/maxKeyword     (default 0.7 / 0.3)
```

Normalizing against the best score in the set, with 0 as the theoretical minimum, puts cosine similarity and `ts_rank_cd` on one scale. This convex combination (sometimes called TM2C2) generally beats rank-only fusion when the scores are meaningful. Both weights are environment variables.

Recall pulls about 15 candidates per method (configurable). Only the reranked top 5–10, depending on the question type, go to the model.

### 4.4 Reranking (`retrieval/reranking-service.ts`)

`Reranker` is an interface; a cross-encoder or a hosted reranker (Cohere, Voyage, Jina) is one class away.

- **`HeuristicReranker` (default).** It starts from the hybrid score and adds explainable boosts: exact quoted phrase, the explicitly requested chapter, a mentioned chapter, query-term coverage, and a section/chapter title match. It then applies **MMR** (maximal marginal relevance), penalizing adjacent or overlapping and lexically similar chunks, so the context isn't five versions of the same paragraph. Broad questions get stronger diversity.
- **Clearly unrelated candidates are dropped** when their cosine similarity is below a cutoff. Keyword hits alone don't count, because off-topic questions share words like "explain" or "write" with almost any book. Exact quoted phrases, pages the reader pointed at, and structural strategies such as chapter summaries are exempt.
- **The cutoff depends on the embedding model**, because similarity scales differ: text-embedding-3 scores unrelated text around 0.1, while nomic-embed-text scores it around 0.45. The calibrated defaults are 0.20 and 0.50, and `RETRIEVAL_MIN_SIMILARITY` overrides them.
- **`LLMReranker` (`RERANKER=llm`).** The utility model grades a pre-selected pool, and the grade is blended with the heuristic score. It falls back to the heuristic on any error.

### 4.5 Context, generation and citations (`rag/`)

**Context.** Passages are chosen highest-score-first within a token budget (`CONTEXT_MAX_TOKENS`) and then presented in book order, which helps the model reason about sequence. Each is labeled `S1…Sn` with its chapter, section and pages.

**Message layout.** The prompt keeps three things strictly separate:

- *System:* role, grounding rules, the citation format, and the injection policy.
- *User turn:* `<book_context>` with the sources, an optional `<selected_passage>` from the reader, the reader's question, and per-type guidance.
- *History:* the last six turns, with old citation markers stripped.

**No context, no call.** If retrieval finds nothing relevant, the model is not called at all, and the reader gets a fixed, honest "the book doesn't seem to cover this" answer.

**Streaming.** The answer streams to the browser as NDJSON events: `conversation → status → sources → delta… → done | error`. The UI shows real stages ("Searching the book…", "Reading 7 passages…") and lists the retrieved passages before the text arrives.

**Citation validation.** `[S#]` markers are parsed and normalized. Any marker that doesn't match a retrieved source is removed, so citations can only ever point at chunks that were actually retrieved. `message_sources` stores every retrieved chunk with its scores and a `cited` flag. The UI shows "Sources" (cited) and "N more passages consulted" (retrieved but uncited). If a model cites nothing, the sources are labeled "Passages consulted" and are never shown as citations.

**Stopping.** If the reader presses stop, or leaves mid-answer, the partial answer is kept.

### 4.6 AI providers and local models (`lib/ai/`)

`EmbeddingProvider` and `ChatProvider` are small interfaces. There are two implementations, and the OpenAI one also reaches compatible APIs such as Gemini:

| Provider | Embeddings | Chat |
| --- | --- | --- |
| **Ollama** (`AI_PROVIDER=ollama`, default) | `POST /api/embed` | `POST /api/chat` (NDJSON stream) |
| **OpenAI** (`AI_PROVIDER=openai`) | Embeddings API | Chat Completions API (streaming). `OPENAI_BASE_URL` covers compatible servers |
| **Google Gemini** (via the OpenAI provider) | `gemini-embedding-001`, shortened to 1,536 dimensions | Chat Completions through Gemini's OpenAI-compatible endpoint; `OPENAI_REASONING_EFFORT=minimal`, since thinking counts against the answer-length limit |

Local models bring constraints that hosted APIs hide:

- **Explicit context window.** The Ollama provider uses Ollama's *native* API because only it lets each request set `num_ctx`. If a prompt is longer than the server's default window, Ollama silently drops its *beginning*, and the beginning is where the system prompt with the grounding and injection rules lives.
  - The passage budget is derived from the window: window − answer − about 2,200 tokens of prompt overhead.
  - As a final safeguard, the provider trims the oldest conversation turns. It never drops the system prompt or the question.
- **Latency-aware budget.** Local models read prompts at a few hundred tokens per second, so the default passage budget is about 3,000 tokens, versus 7,000 for OpenAI. That keeps the time to first word in seconds.
- **Vector size.** Local embedding models output 384–1,024 dimensions; the column holds 1,536. Shorter vectors are zero-padded, which changes neither norms nor dot products, so cosine similarity is exactly preserved and one schema serves every provider. Larger vectors are rejected with a clear message.
- **Model-specific prefixes.** For example, `nomic-embed-text` expects `search_document:` and `search_query:`. These are applied automatically for known models and can be overridden.
- **Model identity.** Each book records the vector space it was indexed in, as `provider:model`. If the configured model differs, chat refuses with a clear message, and the book page shows a *Re-index now* banner.
- **Reasoning models.** Inline `<think>…</think>` blocks are stripped from streamed output. `OLLAMA_THINK=false` disables thinking for faster answers.
- **Error mapping.** Errors become specific, user-safe messages:

  | Situation | Behavior |
  | --- | --- |
  | Model not pulled | "model isn't available", not retried |
  | Server down | "couldn't reach the AI service", retried with backoff |
  | Out of memory | "model isn't available" |
  | OpenAI out of credits | "out of credits or over quota", not retried |

`npm run ai:check` (`lib/ai/health.ts`) checks the setup end to end, and the seed runs it as a preflight. It verifies that the server is reachable, that the models are pulled, and that the context window suits the model, then runs a real embed and chat round trip. For each problem it prints the exact fix, such as `ollama pull llama3.1:8b`.

## 5. Security

- **No accounts.** There is no sign-in and no user data: the app is one shared library, so anyone who can reach it can upload, read and chat. Renaming and deleting can be switched off (`NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false`). Mutating requests from other origins are rejected. Adding accounts later would mean new tables and owner columns in a migration.
- **CSRF.** SameSite cookies, plus an `Origin` check on every mutating API request.
- **Input validation.** zod on every body and query. Route ids must be UUIDs (anything else is a 404, never a database error). Length limits apply to questions and selections.
- **Files.**
  - Uploads are checked for the extension and the `%PDF-` signature, and the body is buffered with a hard size cap (`MAX_UPLOAD_MB`).
  - Files are stored under server-generated keys; user filenames are never used as paths. Keys are validated against path traversal.
  - PDFs are served only through an API route with `nosniff` and a sanitized `Content-Disposition`.
  - `MAX_PDF_PAGES` caps the work per book.
- **Rate limits.** A Postgres-backed fixed window covers chat and uploads (`429` with `Retry-After`), with optional daily caps (`RATE_LIMIT_CHAT_PER_DAY`, `RATE_LIMIT_UPLOADS_PER_DAY`). There are no accounts, so the limits are shared by everyone using the app. `NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false` turns off renaming and deleting for public deployments.
- **Errors.** `AppError` carries a code, a status and a user-safe message. Unknown errors become a generic 500. Stack traces, provider messages and SQL never reach the client. A Book's `processing_error` only ever holds a user-facing sentence.
- **Headers.** `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, and no `X-Powered-By`.

### Prompt injection

Book text is treated as **untrusted data**:

1. The system prompt states that retrieved content is untrusted reference material whose instructions must never be followed, and that it may be used only as evidence. Anything inside `<book_context>`/`<selected_passage>` is data, even if it claims otherwise.
2. Book text appears only in the user turn, inside delimiters. Instructions appear only in the system message.
3. `sanitizeBookText` neutralizes anything in book text that could close or forge our tags (`</source>`, `<system>`, …), so a passage can't escape its block.
4. Output is constrained after the fact. Citations are validated against retrieved ids, and Markdown is rendered with raw HTML disabled, external links set to `rel=noopener noreferrer nofollow`, and **no images**. Images are the classic channel for exfiltrating data through injected URLs.
5. Internal model calls (query rewriting, insights, LLM reranking) carry the same "data, not instructions" framing, and their outputs are parsed and validated with zod.

## 6. Background jobs

- **Contracts.** `JobQueue` (enqueue) and `JobHandler` (`run`, `isRetryable`, `onFailure`) are transport-agnostic.
- **Postgres implementation.** `PostgresJobQueue` and `PostgresJobWorker`:
  - **Claiming:** `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED LIMIT 1)`, so any number of workers can run safely.
  - **Liveness:** jobs send heartbeats, and a crashed worker's job is reclaimed after the lock timeout.
  - **Retries:** exponential backoff for transient errors (AI rate limits, outages, database blips). Document errors (corrupt or encrypted PDF, no text) fail immediately with a precise message.
  - **Deduplication:** the partial unique index makes enqueueing idempotent per book.
  - **Latency:** an in-process signal wakes the embedded worker immediately after an upload; otherwise it polls.
- **Hosting.** `instrumentation.ts` starts the worker inside the Next.js server (development and single-instance deployments). Set `RUN_WORKER_IN_PROCESS=false` and run `npm run worker` to scale ingestion separately.
- **Moving to BullMQ/Redis or a managed queue** means implementing `JobQueue.enqueue` with `queue.add` and a worker that calls the same `JobHandlers`. The ingestion code doesn't change.

## 7. Observability

Logs are structured events: JSON in production, compact lines in development. Each event has a stable name and numeric fields, and never contains book text or user questions.

| Event | Fields |
| --- | --- |
| `document.processed` | pages, words, chapters, chapter source, removed header/footer lines, duration |
| `ingestion.chunked` / `ingestion.embedded` / `ingestion.completed` | chunk count, average tokens, model, duration |
| `jobs.started` / `jobs.completed` / `jobs.retry_scheduled` / `jobs.failed` | attempt, delay, error |
| `retrieval.completed` | strategy, query type, candidates, latency |
| `llm.completed` | model, latency, time to first token, prompt and completion tokens, sources, cited and invalid citations |
| `chat.answered` | per-request summary |

Per-message metadata stores the model, token usage and latencies for later analysis.

## 8. Performance

- **Library lists** select only card columns, with indexed ordering, pagination, and polling only while a book is processing.
- **Retrieval** never loads a book's chunks into memory. Recall queries return ids, and only candidates (about 15–40 rows) are hydrated.
- **Indexes:** HNSW for vectors, GIN for `tsvector`, btree for all foreign-key lookups and list orderings. `ANALYZE` runs after ingestion.
- **Query embeddings** are cached in an LRU, which helps repeated suggested prompts.
- **Answers stream** token by token, and the next reader page is prefetched.
- **Ingestion** processes pages one at a time, inserts in batches of 200, embeds in batches, and runs in the background.

## 9. Testing

`npm test` (Vitest) runs about 60 tests in a few seconds, with no Docker:

| Area | What it covers |
| --- | --- |
| Unit | Chunking (paragraph integrity, size limits, metadata, overlap, chapter and section boundaries, oversized paragraphs, page-break continuations); cleaning and structure detection (headers/footers, page numbers, hyphenation, headings, contents pages, title/author); a real PDF round trip through pdf.js; query analysis; citation validation; injection sanitization; prompt layout; score fusion |
| Integration | Run on **PGlite** (Postgres in WASM, with pgvector) using the real migrations. Covers book-scoped retrieval, semantic, keyword and hybrid ranking, chapter filters and strategies; RAG (context reaches the model, citations map to real chunks, fabricated citations removed, the no-context path never calls the model, multi-turn history); and ingestion end to end (upload → job → READY, corrupt PDFs, retry/backoff → failure → resume, upload validation, job deduplication) |

Fakes: a deterministic hashing embedding provider (related text really is more similar), a chat provider that records every request it receives, and in-memory storage.

## 10. Key decisions and trade-offs

| Decision | Why |
| --- | --- |
| **Postgres + pgvector as the only datastore** | One system for relational data, vectors, full-text, jobs and rate limits. Transactions span chunks and vectors, filtering by book or chapter is a WHERE clause, and operations stay simple. pgvector with HNSW handles millions of chunks; a dedicated vector DB can come later if needed |
| **Drizzle ORM** | First-class `vector` columns, HNSW/GIN index definitions, generated columns and raw SQL where it matters (hybrid retrieval). SQL migrations are reviewable, and the same migrations run on PGlite in tests |
| **Hybrid retrieval with score fusion** | Embeddings miss exact names, quotes and rare terms; keywords miss paraphrase. Weighted fusion of normalized scores is simple, tunable (0.7/0.3) and explainable |
| **Query understanding as rules, not agents** | Covers the high-value cases (chapter references, comparisons, summaries, quotes, follow-ups) deterministically, testably and without added latency |
| **Structure-aware chunking with contextual headers** | Chunks that respect chapters and paragraphs make better evidence and better citations. Headers improve recall for passages that never mention their own topic |
| **Postgres job queue** | Durable, retryable and multi-worker safe with no new infrastructure. The interface keeps BullMQ or managed queues one adapter away |
| **Local-first AI (Ollama) via its native API** | No per-token cost and full privacy. The native API is needed to control the context window, so prompts are never silently truncated. Zero-padding keeps a single 1536-dimension schema for every provider |
| **Own provider interfaces** (rather than a framework) | Small, explicit contracts (`EmbeddingProvider`, `ChatProvider`, `Reranker`, `StorageProvider`, `JobQueue`) keep the RAG pipeline independent of vendors and easy to fake in tests |
| **NDJSON streaming over a plain `fetch`** | Lets the server send structured events (stages, sources, deltas, final message) alongside tokens, without extra client libraries |
| **Snapshots in `message_sources`** | Answers keep accurate citations even after a book is reprocessed |
| **Not answering without context** | The cheapest, most reliable way to avoid hallucinated answers on questions the book doesn't cover |

## 11. Extending

- **Another AI provider:** implement `EmbeddingProvider`/`ChatProvider` in `src/lib/ai/` (see `ollama.ts` and `openai.ts`) and add a branch in `createAIProviders`. Any OpenAI-compatible API already works through `OPENAI_BASE_URL`.
- **A different embedding size:** change `VECTOR_DIMENSIONS`, generate a migration, set `EMBEDDING_DIMENSIONS`, and reprocess books.
- **A dedicated reranker:** implement `Reranker` and pass it via `createServices({ reranker })` or a new `RERANKER` option.
- **OCR for scanned books:** add a step in `DocumentProcessor` when extraction finds no text. The rest of the pipeline is unchanged.
- **More upfront structure:** per-chapter summaries generated at ingestion would further improve whole-book and whole-chapter questions.

### Known limitations

- Scanned (image-only) PDFs are rejected with a clear message; there is no OCR yet.
- Multi-column layouts are read in content-stream order. Most books are fine, but some academic papers may interleave columns.
- Book-level questions are answered from representative passages, not from the whole text, and the prompt tells the model to say so.
