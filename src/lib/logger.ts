/**
 * Minimal structured logger.
 *
 * - JSON lines in production (easy to ship to any log pipeline).
 * - Compact, readable lines in development.
 *
 * Convention: the message is a stable dotted event name (e.g. "ingestion.completed")
 * and everything else goes in the fields object. Never log book content or
 * user questions here — log sizes, ids, counts and timings instead.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel(): Level {
  const level = process.env.LOG_LEVEL as Level | undefined;
  if (level && level in LEVELS) return level;
  return process.env.NODE_ENV === "test" ? "warn" : "info";
}

function serializeError(error: unknown): Fields {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(process.env.NODE_ENV !== "production" && error.stack ? { stack: error.stack } : {}),
      ...("code" in error && error.code ? { code: error.code } : {}),
      ...(error.cause ? { cause: serializeError(error.cause) } : {}),
    };
  }
  return { message: String(error) };
}

function normalize(fields: Fields): Fields {
  const out: Fields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = key === "error" || value instanceof Error ? serializeError(value) : value;
  }
  return out;
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields): void;
  error(event: string, fields?: Fields): void;
  child(bindings: Fields): Logger;
}

function createLogger(bindings: Fields = {}): Logger {
  const write = (level: Level, event: string, fields: Fields = {}) => {
    if (LEVELS[level] < LEVELS[currentLevel()]) return;
    const payload = normalize({ ...bindings, ...fields });

    if (process.env.NODE_ENV === "production") {
      const line = JSON.stringify({ level, time: new Date().toISOString(), event, ...payload });
      (level === "error" ? console.error : console.log)(line);
      return;
    }

    const rendered = Object.entries(payload)
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" ");
    const line = `[${level}] ${event}${rendered ? ` ${rendered}` : ""}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (event, fields) => write("debug", event, fields),
    info: (event, fields) => write("info", event, fields),
    warn: (event, fields) => write("warn", event, fields),
    error: (event, fields) => write("error", event, fields),
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();

/** Measure the duration of an async operation in milliseconds. */
export async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await fn();
  return [result, Math.round(performance.now() - start)];
}
