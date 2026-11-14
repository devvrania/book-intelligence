# Deploying for free

Book Intelligence runs as one Next.js app (pages, API and the background PDF worker in one process). The free setup:

| Piece | Service | Free-tier catch |
|---|---|---|
| App | [Render](https://render.com) web service | Sleeps after ~15 idle minutes; the next visit takes 30–60 s to wake. 512 MB of memory |
| Database | [Neon](https://neon.tech) Postgres (pgvector included) | Small storage, enough for dozens of books |
| PDFs and covers | [Supabase](https://supabase.com) Storage, S3-compatible | ~1 GB |
| AI | [Google Gemini API](https://aistudio.google.com) | Daily request limits; Google may use free-tier prompts to improve its products |

There is **no sign-in**: anyone with the link can browse, upload and chat. `render.yaml` therefore sets daily caps
(`RATE_LIMIT_CHAT_PER_DAY`, `RATE_LIMIT_UPLOADS_PER_DAY`) and turns off renaming and deleting
(`NEXT_PUBLIC_ALLOW_BOOK_CHANGES=false`). Free-tier terms change often: check each provider's pricing page.

## 1. Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com) → **Get API key** → **Create API key**.
2. Keep it for step 4 (`OPENAI_API_KEY`). Locally, put it in `.env.local` with the Gemini settings from
   `.env.example` and run `npm run ai:check`.

## 2. Neon database

1. Create a project (pick the region closest to your Render region).
2. **Connect** → copy the connection string. It ends in `?sslmode=require`. This is `DATABASE_URL`.
3. Nothing else: the app's migrations enable pgvector and create the tables on first start.

## 3. Supabase Storage

1. Create a project.
2. **Storage** → **New bucket** → name it (e.g. `books`), keep it **private**. This is `S3_BUCKET`.
3. **Storage** → **Settings** → **S3 connection**: copy the **endpoint** (`S3_ENDPOINT`, like
   `https://<project-ref>.supabase.co/storage/v1/s3`) and the **region** (`S3_REGION`).
4. **New access key** → copy the access key id and secret (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).

## 4. Render

1. Push this repository to GitHub.
2. In Render: **New** → **Blueprint** → pick the repository. Render reads `render.yaml` and creates the
   `book-intelligence` web service on the free plan.
3. Fill in the values it asks for (`sync: false` in `render.yaml`):
   - `NEXT_PUBLIC_APP_URL`: the public address, e.g. `https://books.devvrania.com`
     (or `https://book-intelligence.onrender.com` until the domain is set up)
   - `DATABASE_URL` (step 2), `OPENAI_API_KEY` (step 1), the five `S3_*` values (step 3)
4. Deploy. The start command runs the database migrations, then starts the app.

`NEXT_PUBLIC_*` values are built into the page, so after changing `NEXT_PUBLIC_APP_URL` or
`NEXT_PUBLIC_ALLOW_BOOK_CHANGES`, redeploy with **Clear build cache & deploy**.

## 5. Custom domain (optional)

1. Render → the service → **Settings** → **Custom Domains** → add `books.devvrania.com`.
2. Where devvrania.com's DNS is managed, add the **CNAME** record Render shows
   (`books` → `book-intelligence.onrender.com`). HTTPS is issued automatically.
3. Set `NEXT_PUBLIC_APP_URL=https://books.devvrania.com` and redeploy.

## 6. Sample books (optional)

`npm run db:seed` typesets two public-domain books and processes them. To fill the live library, run it once from
your machine with the production `DATABASE_URL`, `STORAGE_PROVIDER=s3` + `S3_*` and Gemini settings in the
environment, so the books are stored where the deployed app reads them.

## Settings reference

All settings are documented in `.env.example`. The ones specific to this deployment:

| Setting | Value | Why |
|---|---|---|
| `AI_PROVIDER` / `OPENAI_BASE_URL` | `openai` / Gemini's OpenAI-compatible URL | Gemini through the existing OpenAI client |
| `OPENAI_EMBEDDING_MODEL` | `gemini-embedding-001` | Shortened to 1,536 dimensions to fit the vector column |
| `STORAGE_PROVIDER` | `s3` | Render's free disk is wiped on every restart |
| `MAX_UPLOAD_MB` / `MAX_PDF_PAGES` | `25` / `800` | Keeps processing inside 512 MB of memory |
| `RATE_LIMIT_CHAT_PER_DAY` / `RATE_LIMIT_UPLOADS_PER_DAY` | `100` / `5` | Shared by all visitors; keeps you inside Gemini's free quota |
| `NEXT_PUBLIC_ALLOW_BOOK_CHANGES` | `false` | Visitors can't rename or delete books and chats |

Books processed with another embedding model (e.g. local Ollama) must be processed again after switching to Gemini;
the app shows a banner for them.
