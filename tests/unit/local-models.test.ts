import OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIProviderError, type EmbeddingProvider } from "@/lib/ai";
import {
  classifyOllamaError,
  fitToContext,
  OllamaChatProvider,
  OllamaEmbeddingProvider,
  stripThinking,
  ThinkTagFilter,
} from "@/lib/ai/ollama";
import { mapOpenAIError } from "@/lib/ai/openai";
import { EmbeddingService } from "@/lib/embeddings/embedding-service";
import { defaultMinSimilarity, describeEmbeddingModel, embeddingModelsMatch } from "@/lib/embeddings/model-id";

const connection = { baseUrl: "http://ollama.test" };

function ndjson(lines: object[]) {
  const body = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
  // Split mid-line to exercise buffering across network chunks.
  const parts = [body.slice(0, 37), body.slice(37, 90), body.slice(90)];
  return new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }));
}

afterEach(() => vi.unstubAllGlobals());

describe("Ollama chat provider", () => {
  it("streams answers, sets the context window and strips <think> blocks", async () => {
    const fetchMock = vi.fn(async () =>
      ndjson([
        { model: "qwen3", message: { content: "<think>hidden reas" } },
        { model: "qwen3", message: { content: "oning</think>\n\nCompost " } },
        { model: "qwen3", message: { content: "feeds the soil [S1]." } },
        { model: "qwen3", message: { content: "" }, done: true, done_reason: "stop", prompt_eval_count: 900, eval_count: 12 },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OllamaChatProvider({ ...connection, numCtx: 8192, numPredict: 500, temperature: 0.2 }, "qwen3");
    let text = "";
    let done: unknown;
    for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
      if (event.type === "delta") text += event.text;
      else done = event;
    }

    expect(text).toBe("Compost feeds the soil [S1].");
    expect(done).toMatchObject({ type: "done", model: "qwen3", usage: { promptTokens: 900, completionTokens: 12 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://ollama.test/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 500, temperature: 0.2 });
    expect(body.stream).toBe(true);
    expect(provider.contextWindow).toBe(8192);
  });

  it("maps missing models and an unreachable server to clear errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: 'model "llama9" not found, try pulling it first' }), { status: 404 })));
    const provider = new OllamaChatProvider({ ...connection, numCtx: 4096, numPredict: 200 }, "llama9");
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ kind: "model_unavailable" });

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(provider.complete({ messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({
      kind: "unavailable",
      retryable: true,
    });

    expect(classifyOllamaError(500, "model requires more system memory (9.1 GiB) than is available").kind).toBe("model_unavailable");
  });

  it("drops the oldest turns to fit the context, never the system prompt or the question", () => {
    const long = "word ".repeat(600);
    const messages = [
      { role: "system" as const, content: "rules" },
      { role: "user" as const, content: long },
      { role: "assistant" as const, content: long },
      { role: "user" as const, content: "context and question" },
    ];
    const fitted = fitToContext(messages, 900);
    // The oldest history turn is dropped; system prompt and final question survive.
    expect(fitted.map((m) => m.role)).toEqual(["system", "assistant", "user"]);
    expect(fitted[0].content).toBe("rules");
    expect(fitted.at(-1)!.content).toBe("context and question");
    expect(() => fitToContext([{ role: "system", content: long }, { role: "user", content: long }], 100)).toThrow(AIProviderError);
  });

  it("filters think tags split across chunks", () => {
    const filter = new ThinkTagFilter();
    const out = ["Hel", "lo <thi", "nk>secret</th", "ink> world"].map((part) => filter.push(part)).join("") + filter.flush();
    expect(out).toBe("Hello  world");
    expect(stripThinking("<think>a</think>\n\nAnswer")).toBe("Answer");
  });
});

describe("local embeddings", () => {
  it("calls /api/embed and zero-pads vectors to the database column", async () => {
    const fetchMock = vi.fn(async () => Response.json({ embeddings: [[0.6, 0.8, 0]], prompt_eval_count: 4 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new EmbeddingService(new OllamaEmbeddingProvider(connection, "nomic-embed-text"), { columnDimensions: 8 });

    const vector = await service.embedQuery("What does compost do?");
    expect(vector).toEqual([0.6, 0.8, 0, 0, 0, 0, 0, 0]);
    // nomic-embed-text's query prefix is applied automatically.
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [URL, RequestInit])[1].body));
    expect(body.input).toEqual(["search_query: What does compost do?"]);
    expect(service.model).toBe("ollama:nomic-embed-text");
  });

  it("applies document prefixes and rejects vectors larger than the column", async () => {
    const seen: string[] = [];
    const provider: EmbeddingProvider = {
      id: "ollama",
      model: "nomic-embed-text:latest",
      maxBatchSize: 8,
      maxInputTokens: 2000,
      embed: async (texts) => {
        seen.push(...texts);
        return { embeddings: texts.map(() => [1, 2, 3, 4, 5]) };
      },
    };
    await expect(new EmbeddingService(provider, { columnDimensions: 3 }).embedChunks([{ content: "Roses." }])).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(seen[0]).toBe("search_document: Roses.");

    const service = new EmbeddingService(provider, { columnDimensions: 5, documentPrefix: "none" });
    await service.embedChunks([{ content: "Roses." }]);
    expect(seen[1]).toBe("Roses.");
    expect(service.model).toBe("ollama:nomic-embed-text");
  });

  it("identifies incompatible vector spaces", () => {
    expect(embeddingModelsMatch("text-embedding-3-small", "openai:text-embedding-3-small")).toBe(true);
    expect(embeddingModelsMatch("text-embedding-3-small", "ollama:nomic-embed-text")).toBe(false);
    expect(embeddingModelsMatch("ollama:nomic-embed-text:latest", "ollama:nomic-embed-text")).toBe(true);
    expect(embeddingModelsMatch(null, "ollama:nomic-embed-text")).toBe(true);
    expect(describeEmbeddingModel("text-embedding-3-small")).toBe("text-embedding-3-small (OpenAI)");
    expect(defaultMinSimilarity("ollama:nomic-embed-text")).toBeGreaterThan(defaultMinSimilarity("openai:text-embedding-3-small"));
  });
});

describe("hosted provider errors", () => {
  it("does not retry when the account is out of credits", () => {
    const headers = new Headers();
    const noCredits = mapOpenAIError(
      OpenAI.APIError.generate(429, { error: { message: "You have no credits remaining." } }, "429 You have no credits remaining.", headers),
    );
    expect(noCredits.kind).toBe("quota");
    expect(noCredits.retryable).toBe(false);
    expect(noCredits.userMessage).toMatch(/credits|quota/);

    const busy = mapOpenAIError(OpenAI.APIError.generate(429, { error: { message: "Rate limit reached" } }, "429 Rate limit reached", headers));
    expect(busy.kind).toBe("rate_limit");
    expect(busy.retryable).toBe(true);
  });
});
