import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

/**
 * A fresh in-memory Postgres (PGlite, with pgvector) migrated with the real
 * migrations — the same SQL, indexes and generated columns as production.
 */
export async function createTestDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite({ extensions: { vector } });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return { db: db as unknown as Database, close: () => client.close() };
}
