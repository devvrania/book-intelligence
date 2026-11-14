import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { Pool } from "pg";

import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * Driver-agnostic database type. The app uses node-postgres; tests use PGlite
 * (real Postgres compiled to WASM, with pgvector). Transactions satisfy this
 * type too, so repositories accept either.
 */
export type Database = PgDatabase<PgQueryResultHKT, Schema>;

const globalForDb = globalThis as unknown as { __bookIntelligenceDb?: { pool: Pool; db: Database } };

export function getDb(): Database {
  if (!globalForDb.__bookIntelligenceDb) {
    const env = getEnv();
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (error) => logger.error("db.pool_error", { error }));
    const db = drizzle(pool, { schema }) as unknown as Database;
    globalForDb.__bookIntelligenceDb = { pool, db };
  }
  return globalForDb.__bookIntelligenceDb.db;
}

export async function closeDb() {
  const current = globalForDb.__bookIntelligenceDb;
  if (current) {
    globalForDb.__bookIntelligenceDb = undefined;
    await current.pool.end();
  }
}

/** Execute raw SQL and return typed rows regardless of driver. */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows?: T[] } | T[];
  return Array.isArray(result) ? result : (result.rows ?? []);
}

/** pgvector literal for a JS number array. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}
