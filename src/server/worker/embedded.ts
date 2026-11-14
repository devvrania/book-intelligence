import { getEnv } from "@/lib/config/env";
import type { PostgresJobWorker } from "@/lib/jobs/postgres-queue";
import { logger } from "@/lib/logger";
import { createServices } from "@/server/container";

const globalForWorker = globalThis as unknown as { __bookIntelligenceWorker?: PostgresJobWorker };

/**
 * Run the job worker inside the Next.js server process (development and
 * single-instance deployments). Production setups with several web instances
 * can set RUN_WORKER_IN_PROCESS=false and run `npm run worker` separately.
 */
export async function startEmbeddedWorker() {
  if (globalForWorker.__bookIntelligenceWorker) return;

  let enabled: boolean;
  try {
    enabled = getEnv().RUN_WORKER_IN_PROCESS;
  } catch (error) {
    logger.warn("worker.not_started", { reason: "invalid environment", error });
    return;
  }
  if (!enabled) return;

  // A dedicated service graph: this module is bundled separately from route
  // handlers, so sharing their singleton would mix module instances.
  const worker = createServices().createWorker();
  globalForWorker.__bookIntelligenceWorker = worker;
  worker.start();

  const shutdown = () => void worker.stop();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
