/**
 * Object storage abstraction for uploaded PDFs and derived assets (covers).
 *
 * Keys are opaque, server-generated paths like
 * `books/<bookId>/original.pdf` — never user-supplied names. Each book row stores its exact keys.
 */
export interface StoredObject {
  body: ReadableStream<Uint8Array>;
  size?: number;
  contentType?: string;
}

export interface StorageProvider {
  readonly name: string;
  put(key: string, body: Uint8Array, options: { contentType: string }): Promise<void>;
  /** Read a whole object into memory (used by the ingestion worker). */
  getBuffer(key: string): Promise<Buffer>;
  /** Stream an object (used to serve files to the browser). Null if missing. */
  getStream(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  /** Delete every object under a prefix (e.g. all assets of a book). */
  deletePrefix(prefix: string): Promise<void>;
}

const SAFE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;

/** Reject anything that could escape the storage root or address another tenant. */
export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

export const storageKeys = {
  bookPrefix: (bookId: string) => `books/${bookId}/`,
  bookFile: (bookId: string) => `books/${bookId}/original.pdf`,
  bookCover: (bookId: string) => `books/${bookId}/cover.png`,
};
