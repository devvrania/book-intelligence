# Book Intelligence

**Understand your books. Don't just read them.**

Book Intelligence is an open, AI-powered library. Upload a PDF and the app reads it, finds its chapters and indexes
it. Then ask it anything: every answer comes **only from the book**, with **citations to the exact chapter and page**.
Click a citation and the reader opens on the highlighted passage, so you can check the answer yourself.

There are no accounts: everyone who opens the app shares one library of books and conversations.

> Deep dive into the data model, the RAG pipeline and the design decisions: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**
> · Free deployment guide: **[DEPLOY.md](DEPLOY.md)**

---

## What it does

| | |
| --- | --- |
| **Library** | One shared shelf of books. Drag in a PDF to add one; a progress bar shows it being prepared. |
| **Ask the book** | A chat per book with suggested starter questions. Answers stream in and cite chapter and page. |
| **Sources** | Open any citation to see the exact passage the answer was built from. |
| **Reader** | Read the cleaned pages chapter by chapter; citations jump straight to the highlighted passage. |
| **Your choice of AI** | Free local models with [Ollama](https://ollama.com), Google Gemini's free tier, or OpenAI. |

Answers are **grounded**: the model only sees passages retrieved from the book, and any citation that doesn't point at
one of them is removed before you see it.

## How it works

### Adding a book

Uploading never does heavy work inside the web request. The file is stored, a job goes into a queue in Postgres, and a
background worker prepares the book:

```
PDF ─► extract text ─► clean ─► find chapters ─► split into passages ─► embed ─► ready
       (pdf.js)        headers,   headings,        ~700 tokens, along     vectors in
                       footers,   contents pages   chapters/paragraphs,   pgvector +
                       hyphens                     with page numbers      full-text index
```

It also renders a cover and writes a short description and suggested questions for the book.

### Asking a question (RAG)

```
question ─► understand ─► retrieve ─► rerank ─► answer ─► verify citations ─► stream to you
            book-wide?    hybrid       best       only from   drop any that point
            follow-up?    search       passages   passages    at unretrieved text
```

1. **Understand.** The question is classified: about the whole book, a page, a chapter? Follow-ups ("what about
   chapter 3?") are rewritten into standalone questions.
2. **Retrieve.** Hybrid search combines meaning (pgvector cosine similarity, 70%) with keywords (Postgres full-text
   search, 30%). Book-wide questions deliberately sample every chapter.
3. **Rerank and budget.** The best candidates are kept within a token budget for the prompt.
4. **Answer.** The model is instructed to answer only from the passages and to cite them. Passages are treated as
   data, never as instructions, which defends against prompt injection hidden in a PDF.
5. **Verify.** Citations are checked against what was retrieved; fabricated ones are removed. The answer and its
   sources are saved with the conversation.

## Tech stack

| Layer | Technology |
| --- | --- |
| App | [Next.js 16](https://nextjs.org) (App Router, Route Handlers), React 19, TypeScript |
| UI | Tailwind CSS 4, Radix UI / shadcn, Framer Motion, TanStack Query |
| Database | PostgreSQL + [pgvector](https://github.com/pgvector/pgvector), via [Drizzle ORM](https://orm.drizzle.team) |
| Background jobs | A Postgres-backed queue (`SKIP LOCKED`), worker in-process or standalone |
| PDF processing | pdf.js (via `unpdf`), `@napi-rs/canvas` for covers |
| AI | Ollama (local), or any OpenAI-compatible API: OpenAI, Google Gemini |
| Storage | Local folder, or any S3-compatible store (Supabase Storage, Cloudflare R2, MinIO) |
| Tests | Vitest + PGlite (in-memory Postgres with pgvector) |

## Getting started

### Prerequisites

- **Node.js 22** (≥ 20.9). Run `nvm use` to pick it up from `.nvmrc`.
- **Docker**, for Postgres + pgvector.
- **[Ollama](https://ollama.com)**, for free local AI.

### Run it locally (free, no API key)

```bash
# 1. Local AI models: one to answer, one to index (~5 GB + 0.3 GB)
ollama pull llama3.1:8b
ollama pull nomic-embed-text

# 2. The app
npm install
cp .env.example .env.local
npm run db:up        # Postgres 17 + pgvector on localhost:5434
npm run ai:check     # checks Ollama, the models, and a real embedding + answer
npm run dev          # runs migrations, then starts the app and the background worker
```

Open **<http://localhost:3000>**: the home page is the library.

To try it without your own PDF, load two public-domain sample books:

```bash
npm run db:seed      # The Art of War and Pride and Prejudice (Vol. I)
```

> **Ollama not reachable?** Keep `OLLAMA_BASE_URL=http://127.0.0.1:11434`. Node resolves `localhost` to IPv6 first,
> and Ollama listens on IPv4 only.

### Use Gemini or OpenAI instead

Both go through the same OpenAI-compatible client. In `.env.local`:

```bash
AI_PROVIDER=openai

# OpenAI
OPENAI_API_KEY=sk-...

# or Google Gemini (free tier, key from https://aistudio.google.com)
OPENAI_API_KEY=<your Gemini key>
OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
OPENAI_CHAT_MODEL=gemini-3.5-flash
OPENAI_UTILITY_MODEL=gemini-3.1-flash-lite
OPENAI_REASONING_EFFORT=minimal
OPENAI_EMBEDDING_MODEL=gemini-embedding-001
```

Then run `npm run ai:check`. Books indexed with one embedding model can't be searched with another, so after switching,
existing books show a **Re-index now** banner.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Apply migrations, then start Next.js with the background worker |
| `npm run build` / `npm start` | Production build / server |
| `npm run worker` | Standalone worker (with `RUN_WORKER_IN_PROCESS=false` on the web servers) |
| `npm run ai:check` | Verify the AI setup with a live embedding and answer |
| `npm run db:up` / `db:down` | Start / stop the bundled Postgres + pgvector container |
| `npm run db:migrate` | Apply pending migrations from `drizzle/` |
| `npm run db:generate` | Generate a migration after changing `src/lib/db/schema.ts` |
| `npm run db:studio` | Browse the database (Drizzle Studio) |
| `npm run db:seed` | Typeset and ingest the bundled public-domain books |
| `npm test` | Unit and integration tests (no Docker needed) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |

## Configuration

Every setting is documented in [`.env.example`](.env.example) and validated at startup by
[`src/lib/config/env.ts`](src/lib/config/env.ts). The main ones:

| Setting | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (with pgvector) |
| `NEXT_PUBLIC_APP_URL` | The app's public address, used for origin checks |
| `AI_PROVIDER` | `ollama` (default) or `openai` (OpenAI, Gemini or any compatible API) |
| `OLLAMA_*` / `OPENAI_*` | Models, endpoint and answer settings for each provider |
| `STORAGE_PROVIDER` | `local` (`./storage`) or `s3` with the `S3_*` settings |
| `RUN_WORKER_IN_PROCESS` | `true`: the worker runs inside the web server; `false`: run `npm run worker` |
| `CHUNK_*`, `RETRIEVAL_*`, `CONTEXT_MAX_TOKENS` | Passage sizes, hybrid search weights, relevance cutoff, prompt budget |
| `RATE_LIMIT_*`, `MAX_UPLOAD_MB`, `MAX_PDF_PAGES` | Abuse limits, including optional daily caps |
| `NEXT_PUBLIC_ALLOW_BOOK_CHANGES` | `false` stops visitors renaming and deleting books and chats |

If the AI provider is unavailable the app still starts: you can browse and upload, and processing stops with a clear
message ("model isn't installed", "AI isn't configured") until the setup is fixed and you choose **Try again**.

## Project structure

```
src/
  app/            Pages (the library at /, book, reader) and API route handlers (/api/books, /api/conversations)
  components/     UI: library, books, chat, reader
  features/       Client data hooks (TanStack Query) and the chat stream
  lib/
    ai/           Ollama and OpenAI-compatible providers, health check
    documents/    PDF extraction, cleaning, chapter detection, chunking
    embeddings/   Embedding service and model identity
    retrieval/    Query analysis and rewriting, hybrid search, reranking
    rag/          Context building, prompts, citation validation
    db/           Drizzle schema and client
    jobs/         Postgres job queue
    storage/      Local and S3 storage
    library/      Feature flags (e.g. whether visitors may rename and delete)
  server/         Services, repositories, HTTP wrapper, worker
drizzle/          SQL migrations
scripts/          migrate, seed, worker, ai:check
seed/books/       Public-domain texts for the demo library
tests/            Unit and integration tests
docs/             Architecture notes
```

## Database

One PostgreSQL database is both the relational store and the vector store.

- **Docker (recommended):** `npm run db:up` starts `pgvector/pgvector:pg17` on port **5434**, so it won't clash with
  a local Postgres. `npm run db:down -- -v` deletes its data.
- **Your own Postgres (14+):** install pgvector **0.8+** and point `DATABASE_URL` at it. The first migration runs
  `CREATE EXTENSION IF NOT EXISTS vector`; on managed services (Neon, Supabase, RDS) enable pgvector first if needed.

Migrations are SQL files in [`drizzle/`](drizzle), generated from [`src/lib/db/schema.ts`](src/lib/db/schema.ts):

- `0000` enables pgvector
- `0001` creates the 9 tables (books, chapters, pages, passages, conversations, messages, message sources, jobs,
  rate limits), the HNSW vector index and the full-text index. There are no user or account tables.

## Testing

```bash
npm test
```

Integration tests boot an in-memory Postgres with pgvector (PGlite) and run the real migrations, so they exercise the
same SQL as production. They cover chunking, cleaning and chapter detection, hybrid retrieval, prompt building,
and citation validation, and ingestion end to end (including retries and corrupt PDFs).

## Deployment

The app needs Node 20.9+, Postgres with pgvector, S3-compatible storage and an AI provider.

- **Free setup:** Render (app) + Neon (database) + Supabase Storage (files) + Gemini (AI). `render.yaml` is ready;
  follow **[DEPLOY.md](DEPLOY.md)**.
- **Single instance:** `npm run build && npm start` with the default `RUN_WORKER_IN_PROCESS=true`.
- **Several web instances:** set `RUN_WORKER_IN_PROCESS=false` and run `npm run worker` processes; the queue's
  `SKIP LOCKED` makes several workers safe.

Run `npm run db:migrate` on every deploy (the Render config does it at start).

## Good to know

- **No accounts, no personal data.** There are no user tables: the database only holds books, passages and anonymous
  chats. Anyone who can reach the app can browse, upload and chat. For a public deployment, set
  `NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false` and the daily caps, as `render.yaml` does.
- **Chats are public.** Every book has one shared conversation, visible to everyone who opens the book.
- **Copyright.** Only upload books you're allowed to share. The bundled seed texts are public domain
  (Project Gutenberg #17405 and #1342).
