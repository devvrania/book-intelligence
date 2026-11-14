/**
 * Application error hierarchy.
 *
 * Every AppError carries a stable machine-readable `code`, an HTTP `status`,
 * and a `userMessage` that is safe to show to end users. Internal details stay
 * in `message`/`cause` and are only logged.
 */

/**
 * Brand checked by `isAppError`. A global symbol (not `instanceof`) because
 * Next.js may load this module in more than one bundle (e.g. the
 * instrumentation hook and route handlers), each with its own class identity.
 */
const APP_ERROR = Symbol.for("book-intelligence.app-error");

export class AppError extends Error {
  readonly [APP_ERROR] = true;
  readonly code: string;
  readonly status: number;
  readonly userMessage: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    userMessage: string,
    options: { message?: string; cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(options.message ?? userMessage, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    
    this.userMessage = userMessage;
    this.details = options.details;
  }
}

/** An action switched off on this deployment (see NEXT_PUBLIC_ALLOW_BOOK_CHANGES). */
export class ForbiddenError extends AppError {
  constructor(message = "This action is turned off here.") {
    super("forbidden", 403, message);
  }
}

/** A book, conversation, page or passage that doesn't exist. */
export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super("not_found", 404, `${resource} not found.`);
  }
}

export class ValidationError extends AppError {
  constructor(userMessage: string, details?: Record<string, unknown>) {
    super("validation_error", 400, userMessage, { details });
  }
}

export class ConflictError extends AppError {
  constructor(userMessage: string) {
    super("conflict", 409, userMessage);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(userMessage: string) {
    super("payload_too_large", 413, userMessage);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(userMessage: string) {
    super("unsupported_media_type", 415, userMessage);
  }
}

export class RateLimitError extends AppError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number, userMessage = "You're going a little fast. Please wait a moment and try again.") {
    super("rate_limited", 429, userMessage, { details: { retryAfterSeconds } });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(userMessage: string, options: { cause?: unknown; message?: string } = {}) {
    super("service_unavailable", 503, userMessage, options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && (error as { [APP_ERROR]?: boolean })[APP_ERROR] === true;
}

export const GENERIC_ERROR_MESSAGE = "Something went wrong on our side. Please try again.";

/** A user-safe message for any thrown value. */
export function toUserMessage(error: unknown): string {
  return isAppError(error) ? error.userMessage : GENERIC_ERROR_MESSAGE;
}
