import type {
  AIProviders,
  ChatCompletion,
  ChatProvider,
  ChatRequest,
  ChatStreamEvent,
  EmbeddingProvider,
  EmbeddingResult,
} from "@/lib/ai";
import { AIProviderError } from "@/lib/ai";
import type { StorageProvider, StoredObject } from "@/lib/storage";

const DIMS = 1536;
const STOPWORDS = new Set(
  "the and for are but not you all any can had her was one our out has his how its may new now see two who did get let put say she too use that this with from they will what when where which while would about there their them then than been have into more some such only also very book chapter section".split(" "),
);

function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic "semantic" embedding via signed feature hashing of word stems.
 * Texts sharing vocabulary get high cosine similarity; unrelated texts ≈ 0.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(DIMS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    const stem = word.replace(/(ing|ed|es|s)$/, "");
    const h = hash(stem);
    vector[h % DIMS] += h & 0x8000 ? 1 : -1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = "fake";
  readonly model = "fake-embedding-1536";
  readonly dimensions = DIMS;
  readonly maxBatchSize = 16;
  readonly maxInputTokens = 8191;
  calls = 0;
  inputs: string[] = [];
  failWith: Error | null = null;

  async embed(texts: string[]): Promise<EmbeddingResult> {
    this.calls++;
    if (this.failWith) throw this.failWith;
    this.inputs.push(...texts);
    return { embeddings: texts.map(fakeEmbedding), usage: { promptTokens: texts.join(" ").length / 4 } };
  }
}

export type Responder = (request: ChatRequest) => string;

/** Cites the first source it was given, so citation plumbing is exercised. */
export const citeFirstSource: Responder = (request) => {
  const user = request.messages[request.messages.length - 1]?.content ?? "";
  const ids = [...user.matchAll(/<source id="(S\d+)"/g)].map((match) => match[1]);
  return ids.length ? `According to the book, the answer is in the passage [${ids[0]}].` : "No sources.";
};

export class FakeChatProvider implements ChatProvider {
  readonly id = "fake";
  readonly model = "fake-chat";
  requests: ChatRequest[] = [];

  constructor(public respond: Responder = citeFirstSource) {}

  async complete(request: ChatRequest): Promise<ChatCompletion> {
    this.requests.push(request);
    return { text: this.respond(request), model: this.model };
  }

  async *stream(request: ChatRequest): AsyncIterable<ChatStreamEvent> {
    this.requests.push(request);
    const text = this.respond(request);
    for (const piece of text.match(/[\s\S]{1,12}/g) ?? []) yield { type: "delta", text: piece };
    yield { type: "done", model: this.model, usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 } };
  }
}

/** Behaves like a missing API key: utility features fall back to heuristics. */
export class UnconfiguredChat implements ChatProvider {
  readonly id = "unconfigured";
  readonly model = "none";
  async complete(): Promise<never> {
    throw new AIProviderError("not_configured");
  }
  async *stream(): AsyncIterable<never> {
    throw new AIProviderError("not_configured");
  }
}

export function fakeAI(chat = new FakeChatProvider()) {
  const embeddings = new FakeEmbeddingProvider();
  const ai: AIProviders = { embeddings, chat, utility: new UnconfiguredChat() };
  return { ai, embeddings, chat };
}

export class MemoryStorage implements StorageProvider {
  readonly name = "memory";
  readonly objects = new Map<string, { body: Uint8Array<ArrayBuffer>; contentType: string }>();

  async put(key: string, body: Uint8Array, options: { contentType: string }) {
    this.objects.set(key, { body: new Uint8Array(body), contentType: options.contentType });
  }
  async getBuffer(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`missing ${key}`);
    return Buffer.from(object.body);
  }
  async getStream(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return { body: new Blob([object.body]).stream(), size: object.body.byteLength, contentType: object.contentType };
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async deletePrefix(prefix: string) {
    for (const key of [...this.objects.keys()]) if (key.startsWith(prefix)) this.objects.delete(key);
  }
}
