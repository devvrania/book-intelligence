import { EventEmitter } from "node:events";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";

import { queryRows, type Database } from "@/lib/db/client";
import { processingJobs } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

import type { EnqueueOptions, EnqueueResult, JobContext, JobHandlers, JobPayloads, JobQueue, JobType } from "./types";

/** In-process signal so an embedded worker starts immediately instead of waiting for its next poll. */
const jobSignals = (globalThis as { __bookIntelligenceJobSignals?: EventEmitter }).__bookIntelligenceJobSignals ??=
  new EventEmitter();

export class PostgresJobQueue implements JobQueue {
  constructor(private readonly db: Database) {}

  async enqueue<T extends JobType>(type: T, payload: JobPayloads[T], options: EnqueueOptions = {}): Promise<EnqueueResult> {
    const rows = await this.db
      .insert(processingJobs)
      .values({
        type,
        payload: payload as unknown as Record<string, unknown>,
        bookId: options.bookId ?? null,
        runAt: options.runAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 3,
      })
      // The partial unique index (book_id, type) WHERE active makes this idempotent.
      .onConflictDoNothing()
      .returning({ id: processingJobs.id });

    const id = rows[0]?.id ?? null;
    if (id) jobSignals.emit("enqueued");
    logger.info("jobs.enqueued", { type, jobId: id, bookId: options.bookId, deduplicated: !id });
    return { id, deduplicated: !id };
  }
}

interface ClaimedJob {
  id: string;
  type: JobType;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface WorkerOptions {
  concurrency?: number;
  pollIntervalMs?: number;
  /** A running job whose heartbeat is older than this is considered abandoned. */
  lockTimeoutMs?: number;
  heartbeatMs?: number;
  /** Base delay for exponential retry backoff. */
  retryBaseDelayMs?: number;
}

export class PostgresJobWorker {
  readonly workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private running = false;
  private active = 0;
  private readonly sleepers = new Set<() => void>();
  private loops: Promise<void>[] = [];
  private readonly options: Required<WorkerOptions>;

  constructor(
    private readonly db: Database,
    private readonly handlers: JobHandlers,
    options: WorkerOptions = {},
  ) {
    this.options = {
      concurrency: options.concurrency ?? 1,
      pollIntervalMs: options.pollIntervalMs ?? 2000,
      lockTimeoutMs: options.lockTimeoutMs ?? 10 * 60_000,
      heartbeatMs: options.heartbeatMs ?? 30_000,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 15_000,
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    const onEnqueued = () => this.wakeAll();
    jobSignals.on("enqueued", onEnqueued);
    logger.info("worker.started", { workerId: this.workerId, concurrency: this.options.concurrency });

    for (let i = 0; i < this.options.concurrency; i++) {
      this.loops.push(
        (async () => {
          while (this.running) {
            const worked = await this.runOnce().catch((error) => {
              logger.error("worker.loop_error", { error });
              return false;
            });
            if (!worked && this.running) await this.sleep();
          }
        })(),
      );
    }
    void Promise.all(this.loops).finally(() => jobSignals.off("enqueued", onEnqueued));
  }

  async stop() {
    this.running = false;
    this.wakeAll();
    await Promise.all(this.loops);
    this.loops = [];
    logger.info("worker.stopped", { workerId: this.workerId });
  }

  private sleep() {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, this.options.pollIntervalMs);
      this.sleepers.add(done);
    });
  }

  private wakeAll() {
    for (const wake of [...this.sleepers]) wake();
  }

  /** Claim and run a single job. Returns false when the queue is empty. */
  async runOnce(): Promise<boolean> {
    const job = await this.claim();
    if (!job) return false;
    this.active++;
    try {
      await this.execute(job);
    } finally {
      this.active--;
    }
    return true;
  }

  /** Run until no job is immediately available (used by the seed script and tests). */
  async drain(maxJobs = 1000): Promise<number> {
    let processed = 0;
    while (processed < maxJobs && (await this.runOnce())) processed++;
    return processed;
  }

  private async claim(): Promise<ClaimedJob | null> {
    const lockTimeoutSeconds = Math.round(this.options.lockTimeoutMs / 1000);
    const rows = await queryRows<{
      id: string;
      type: JobType;
      payload: Record<string, unknown>;
      attempts: number;
      max_attempts: number;
    }>(
      this.db,
      sql`
        update ${processingJobs}
        set status = 'running', locked_at = now(), locked_by = ${this.workerId},
            attempts = attempts + 1, updated_at = now()
        where id = (
          select id from ${processingJobs}
          where (status = 'queued' and run_at <= now())
             or (status = 'running' and locked_at < now() - make_interval(secs => ${lockTimeoutSeconds}))
          order by run_at
          for update skip locked
          limit 1
        )
        returning id, type, payload, attempts, max_attempts
      `,
    );
    const row = rows[0];
    return row
      ? { id: row.id, type: row.type, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts }
      : null;
  }

  private async execute(job: ClaimedJob) {
    const log = logger.child({ jobId: job.id, jobType: job.type, attempt: job.attempts });
    const handler = this.handlers[job.type] as JobHandlers[JobType] | undefined;
    const context: JobContext = {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.maxAttempts,
      isFinalAttempt: job.attempts >= job.maxAttempts,
    };
    const payload = job.payload as unknown as JobPayloads[JobType];

    if (!handler) {
      await this.markFailed(job.id, `No handler registered for job type "${job.type}"`);
      log.error("jobs.no_handler");
      return;
    }
    if (job.attempts > job.maxAttempts) {
      // Reclaimed after repeated crashes: give up rather than loop forever.
      const error = new Error("Job exceeded its attempts (worker interrupted)");
      await this.markFailed(job.id, error.message);
      await handler.onFailure?.(payload, error, context).catch((e) => log.error("jobs.on_failure_error", { error: e }));
      return;
    }

    const heartbeat = setInterval(() => {
      void this.db
        .update(processingJobs)
        .set({ lockedAt: new Date() })
        .where(eq(processingJobs.id, job.id))
        .catch((error) => log.warn("jobs.heartbeat_failed", { error }));
    }, this.options.heartbeatMs);

    const started = performance.now();
    try {
      log.info("jobs.started");
      await handler.run(payload, context);
      await this.db
        .update(processingJobs)
        .set({ status: "completed", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null })
        .where(eq(processingJobs.id, job.id));
      log.info("jobs.completed", { durationMs: Math.round(performance.now() - started) });
    } catch (error) {
      const retryable = handler.isRetryable?.(error) ?? true;
      const message = error instanceof Error ? error.message : String(error);
      if (retryable && !context.isFinalAttempt) {
        const delayMs = this.options.retryBaseDelayMs * 2 ** (job.attempts - 1);
        await this.db
          .update(processingJobs)
          .set({ status: "queued", runAt: new Date(Date.now() + delayMs), lockedAt: null, lockedBy: null, lastError: message })
          .where(eq(processingJobs.id, job.id));
        log.warn("jobs.retry_scheduled", { error, delayMs });
      } else {
        await this.markFailed(job.id, message);
        log.error("jobs.failed", { error, durationMs: Math.round(performance.now() - started) });
        await handler.onFailure?.(payload, error, context).catch((e) => log.error("jobs.on_failure_error", { error: e }));
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async markFailed(jobId: string, message: string) {
    await this.db
      .update(processingJobs)
      .set({ status: "failed", lockedAt: null, lockedBy: null, lastError: message.slice(0, 2000) })
      .where(eq(processingJobs.id, jobId));
  }
}
