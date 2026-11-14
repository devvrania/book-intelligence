import { sql } from "drizzle-orm";

import { queryRows, type Database } from "@/lib/db/client";
import { RateLimitError } from "@/lib/errors";

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

export interface RateLimiter {
  /** Count one request against `key`; throws RateLimitError when over the limit. */
  consume(key: string, rule: RateLimitRule): Promise<void>;
}

/**
 * Fixed-window rate limiter stored in Postgres: one atomic upsert per request,
 * shared by every app instance. Adequate for the AI endpoint limits;
 * swap for a Redis implementation if request volume grows.
 */
export class PostgresRateLimiter implements RateLimiter {
  constructor(private readonly db: Database) {}

  async consume(key: string, rule: RateLimitRule): Promise<void> {
    const [row] = await queryRows<{ count: number; retry_after: number | string }>(
      this.db,
      sql`
        insert into rate_limits as r (key, window_start, count)
        values (${key}, now(), 1)
        on conflict (key) do update set
          count = case when r.window_start <= now() - make_interval(secs => ${rule.windowSeconds}) then 1 else r.count + 1 end,
          window_start = case when r.window_start <= now() - make_interval(secs => ${rule.windowSeconds}) then now() else r.window_start end
        returning count,
          greatest(1, ceil(extract(epoch from (window_start + make_interval(secs => ${rule.windowSeconds}) - now()))))::int as retry_after
      `,
    );
    if (row && row.count > rule.limit) throw new RateLimitError(Number(row.retry_after));
  }
}

/** No-op limiter for tests and scripts. */
export class NoopRateLimiter implements RateLimiter {
  async consume(): Promise<void> {}
}
