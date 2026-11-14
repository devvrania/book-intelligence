/**
 * Transport-agnostic job contracts.
 *
 * The app only ever talks to `JobQueue` and registers `JobHandler`s. The
 * initial transport is Postgres (no extra infrastructure); a BullMQ/Redis or
 * managed-queue transport would implement the same two pieces without
 * touching the handlers or the code that enqueues work.
 */

export interface JobPayloads {
  ingest_book: { bookId: string };
}

export type JobType = keyof JobPayloads;

export interface EnqueueOptions {
  /** Associates the job with a book; at most one active job per (book, type). */
  bookId?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export interface EnqueueResult {
  id: string | null;
  /** True if an equivalent job was already queued or running. */
  deduplicated: boolean;
}

export interface JobQueue {
  enqueue<T extends JobType>(type: T, payload: JobPayloads[T], options?: EnqueueOptions): Promise<EnqueueResult>;
}

export interface JobContext {
  jobId: string;
  attempt: number;
  maxAttempts: number;
  isFinalAttempt: boolean;
}

export interface JobHandler<T extends JobType = JobType> {
  run(payload: JobPayloads[T], context: JobContext): Promise<void>;
  /** Decide whether a failure should be retried (default: yes). */
  isRetryable?(error: unknown): boolean;
  /** Called once when the job has failed for good. */
  onFailure?(payload: JobPayloads[T], error: unknown, context: JobContext): Promise<void>;
}

export type JobHandlers = { [T in JobType]: JobHandler<T> };
