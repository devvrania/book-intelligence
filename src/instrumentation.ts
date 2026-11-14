/**
 * Next.js server startup hook: starts the background job worker in-process
 * (unless RUN_WORKER_IN_PROCESS=false). Skipped at build time and on the
 * edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startEmbeddedWorker } = await import("./server/worker/embedded");
  await startEmbeddedWorker();
}
