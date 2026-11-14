// Deterministic environment for tests: no real database URL, AI keys or storage are used.
process.env.DATABASE_URL ??= "postgresql://unused-in-tests";
process.env.LOG_LEVEL ??= "error";
process.env.OPENAI_API_KEY = "";
