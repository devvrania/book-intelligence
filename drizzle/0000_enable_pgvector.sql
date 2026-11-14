-- pgvector powers semantic search over book passages. It must exist before 0001 creates the vector column.
CREATE EXTENSION IF NOT EXISTS vector;
