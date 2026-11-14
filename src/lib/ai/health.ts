import type { Env } from "@/lib/config/env";
import { VECTOR_DIMENSIONS } from "@/lib/db/schema";

import type { AIProviders } from "./index";

export interface HealthCheck {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
  fix?: string;
}

export interface HealthReport {
  ok: boolean;
  provider: string;
  checks: HealthCheck[];
}

/** "llama3" and "llama3:latest" are the same model. */
function sameModel(installed: string, configured: string) {
  const normalize = (name: string) => (name.includes(":") ? name : `${name}:latest`).toLowerCase();
  return normalize(installed) === normalize(configured);
}

async function ollamaJson<T>(baseUrl: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function ollamaChecks(env: Env): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];
  let installed: string[];
  try {
    const tags = await ollamaJson<{ models: { name: string }[] }>(env.OLLAMA_BASE_URL, "/api/tags");
    installed = tags.models.map((model) => model.name);
    checks.push({ name: "Ollama server", status: "ok", detail: `reachable at ${env.OLLAMA_BASE_URL}` });
  } catch {
    checks.push({
      name: "Ollama server",
      status: "error",
      detail: `not reachable at ${env.OLLAMA_BASE_URL}`,
      fix: "Start Ollama (open the Ollama app, or run `ollama serve`), or set OLLAMA_BASE_URL.",
    });
    return checks;
  }

  const models = [
    { name: "Chat model", model: env.OLLAMA_CHAT_MODEL },
    ...(env.OLLAMA_UTILITY_MODEL && env.OLLAMA_UTILITY_MODEL !== env.OLLAMA_CHAT_MODEL
      ? [{ name: "Utility model", model: env.OLLAMA_UTILITY_MODEL }]
      : []),
    { name: "Embedding model", model: env.OLLAMA_EMBEDDING_MODEL },
  ];
  for (const { name, model } of models) {
    const present = installed.some((tag) => sameModel(tag, model));
    checks.push(
      present
        ? { name, status: "ok", detail: model }
        : { name, status: "error", detail: `${model} is not installed`, fix: `ollama pull ${model}` },
    );
  }

  try {
    const show = await ollamaJson<{ model_info?: Record<string, unknown> }>(env.OLLAMA_BASE_URL, "/api/show", {
      model: env.OLLAMA_CHAT_MODEL,
    });
    const trained = Object.entries(show.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1];
    if (typeof trained === "number" && env.OLLAMA_NUM_CTX > trained) {
      checks.push({
        name: "Context window",
        status: "warning",
        detail: `OLLAMA_NUM_CTX=${env.OLLAMA_NUM_CTX} is larger than ${env.OLLAMA_CHAT_MODEL}'s ${trained}-token context`,
        fix: `Set OLLAMA_NUM_CTX=${trained}`,
      });
    } else if (typeof trained === "number") {
      checks.push({ name: "Context window", status: "ok", detail: `${env.OLLAMA_NUM_CTX} tokens (model supports ${trained})` });
    }
  } catch {
    // Model missing — already reported above.
  }
  return checks;
}

/**
 * Verify the configured AI provider end to end: reachability, installed
 * models, and a real embedding + chat round trip.
 */
export async function checkAI(env: Env, ai: AIProviders): Promise<HealthReport> {
  const checks: HealthCheck[] = [];

  if (env.AI_PROVIDER === "ollama") {
    checks.push(...(await ollamaChecks(env)));
  } else if (!env.OPENAI_API_KEY) {
    checks.push({
      name: "OpenAI API key",
      status: "error",
      detail: "OPENAI_API_KEY is not set",
      fix: "Add OPENAI_API_KEY to .env.local — or run locally for free with AI_PROVIDER=ollama.",
    });
  }

  if (!checks.some((check) => check.status === "error")) {
    try {
      const started = performance.now();
      const { embeddings } = await ai.embeddings.embed(["health check"], { inputType: "query" });
      const dimensions = embeddings[0]?.length ?? 0;
      const fits = dimensions > 0 && dimensions <= VECTOR_DIMENSIONS;
      checks.push({
        name: "Embeddings",
        status: fits ? "ok" : "error",
        detail: fits
          ? `${dimensions} dimensions${dimensions < VECTOR_DIMENSIONS ? ` (zero-padded to ${VECTOR_DIMENSIONS})` : ""} · ${Math.round(performance.now() - started)} ms`
          : `${dimensions} dimensions — more than the ${VECTOR_DIMENSIONS}-dimension column`,
        fix: fits ? undefined : "Choose an embedding model with at most 1536 dimensions.",
      });
    } catch (error) {
      checks.push({ name: "Embeddings", status: "error", detail: (error as Error).message });
    }

    try {
      const started = performance.now();
      const reply = await ai.chat.complete({
        messages: [{ role: "user", content: "Reply with the single word: ready" }],
        maxOutputTokens: 20,
      });
      checks.push({
        name: "Chat",
        status: reply.text.trim() ? "ok" : "warning",
        detail: `${ai.chat.model} replied “${reply.text.trim().slice(0, 40)}” · ${Math.round(performance.now() - started)} ms`,
      });
    } catch (error) {
      checks.push({ name: "Chat", status: "error", detail: (error as Error).message });
    }
  }

  return { ok: checks.every((check) => check.status !== "error"), provider: env.AI_PROVIDER, checks };
}

export function formatHealthReport(report: HealthReport): string {
  const icon = { ok: "✓", warning: "!", error: "✗" } as const;
  const lines = report.checks.map(
    (check) => `  ${icon[check.status]} ${check.name}: ${check.detail}${check.fix ? `\n      → ${check.fix}` : ""}`,
  );
  return [`AI provider: ${report.provider}`, ...lines].join("\n");
}
