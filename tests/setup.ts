// Deterministic environment for tests: no real database URL, AI keys or storage are used.
process.env.DATABASE_URL ??= "postgresql://unused-in-tests";
process.env.LOG_LEVEL ??= "error";
process.env.OPENAI_API_KEY = "";
// Rate-limited fakes fail at once (the per-minute waiting is covered by tests/unit/rate-limits.test.ts).
process.env.EMBEDDING_RATE_LIMIT_MAX_WAITS = "0";
