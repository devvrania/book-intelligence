import "./load-env";

import { closeDb } from "@/lib/db/client";
import { logger } from "@/lib/logger";
import { createServices } from "@/server/container";

/**
 * Standalone background worker: `npm run worker`.
 * Use with RUN_WORKER_IN_PROCESS=false on the web servers to scale ingestion
 * independently of request handling.
 */
async function main() {
  const services = createServices();
  if (!services.aiConfigured) {
    logger.warn("worker.ai_not_configured", { hint: "Set OPENAI_API_KEY; embedding steps will fail until then." });
  }
  const worker = services.createWorker();
  worker.start();

  const shutdown = async (signal: string) => {
    logger.info("worker.shutdown", { signal });
    await worker.stop();
    await closeDb();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("worker.crashed", { error });
  process.exit(1);
});
