/**
 * Embedding model identity ("provider:model"). Vectors from different models
 * live in different spaces, so a book can only be queried with the model that
 * indexed it.
 */
export function qualifyEmbeddingModel(name: string): string {
  // Older rows stored bare OpenAI model names ("text-embedding-3-small").
  const qualified = /^(openai|ollama|fake|unconfigured):/.test(name) ? name : `openai:${name}`;
  return qualified.replace(/:latest$/, "");
}

export function embeddingModelsMatch(stored: string | null | undefined, current: string): boolean {
  return !stored || qualifyEmbeddingModel(stored) === qualifyEmbeddingModel(current);
}

/** Human-friendly label: "ollama:nomic-embed-text" → "nomic-embed-text (Ollama)". */
export function describeEmbeddingModel(name: string): string {
  const [provider, ...rest] = qualifyEmbeddingModel(name).split(":");
  const providerName = provider === "openai" ? "OpenAI" : provider === "ollama" ? "Ollama" : provider;
  return `${rest.join(":")} (${providerName})`;
}

/**
 * Default "is this passage relevant at all?" cosine cutoff per embedding model.
 * Similarity scales differ a lot between models (OpenAI's text-embedding-3
 * scores unrelated text near 0.1; nomic-embed-text near 0.45), so one global
 * number can't work. Calibrated on the bundled seed books; override with
 * RETRIEVAL_MIN_SIMILARITY.
 */
export function defaultMinSimilarity(model: string): number {
  const id = qualifyEmbeddingModel(model);
  if (/^openai:text-embedding-3/.test(id)) return 0.2;
  if (/^openai:text-embedding-ada/.test(id)) return 0.72;
  if (/^ollama:nomic-embed-text/.test(id)) return 0.5;
  return 0.2;
}
