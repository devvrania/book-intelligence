import "./load-env";

import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { closeDb, getDb } from "@/lib/db/client";
import { logger, timed } from "@/lib/logger";

/**
 * Apply pending migrations from ./drizzle (idempotent). Runs automatically
 * before `npm run dev`, and explicitly via `npm run db:migrate`.
 */
async function main() {
  if (!process.env.DATABASE_URL) {
    console.error(
      "\n✖ DATABASE_URL is not set.\n  Copy the example environment first:  cp .env.example .env.local\n",
    );
    process.exitCode = 1;
    return;
  }

  const db = getDb() as unknown as NodePgDatabase;
  try {
    const [, durationMs] = await timed(() => migrate(db, { migrationsFolder: "drizzle" }));
    logger.info("db.migrated", { durationMs });
  } catch (error) {
    const code = (error as { code?: string }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "3D000") {
      console.error(
        `\n✖ Can't reach Postgres at ${redact(process.env.DATABASE_URL)}.\n  Start the bundled database with:  npm run db:up\n`,
      );
    } else {
      logger.error("db.migration_failed", { error });
    }
    process.exitCode = 1;
  }
}

function redact(url: string) {
  return url.replace(/\/\/([^:/@]+):[^@]+@/, "//$1:•••@");
}

main().finally(() => closeDb());
