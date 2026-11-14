import "./load-env";

import { createAIProviders } from "@/lib/ai";
import { checkAI, formatHealthReport } from "@/lib/ai/health";
import { getEnv } from "@/lib/config/env";

/**
 * `npm run ai:check` — verify the configured AI provider (OpenAI or a local
 * Ollama) is reachable, the models are installed, and embeddings + chat work.
 */
async function main() {
  const env = getEnv();
  const report = await checkAI(env, createAIProviders(env));
  console.log(`\n${formatHealthReport(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
