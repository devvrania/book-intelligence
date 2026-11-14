import type { BookStatus, ProcessingProgress, ProcessingStage } from "@/types/domain";

/**
 * Pure mapping from backend processing state to the UI checklist. Shared by
 * server and client components.
 */

export type StepKey = "UPLOAD" | Exclude<ProcessingStage, "QUEUED" | "COMPLETE">;

export const STEPS: { key: StepKey; label: string }[] = [
  { key: "UPLOAD", label: "Uploading book" },
  { key: "EXTRACTING", label: "Extracting text" },
  { key: "DETECTING_STRUCTURE", label: "Detecting chapters" },
  { key: "CHUNKING", label: "Creating semantic chunks" },
  { key: "EMBEDDING", label: "Generating embeddings" },
  { key: "INDEXING", label: "Building search index" },
];

export type StepState = "done" | "active" | "pending" | "failed";

export interface ProcessingSnapshot {
  status: BookStatus;
  processingStage: ProcessingStage | null;
  processingProgress: ProcessingProgress | null;
}

/** Index of the step currently in progress (or where processing stopped). */
function currentStepIndex({ status, processingStage }: ProcessingSnapshot): number {
  if (status === "UPLOADING") return 0;
  if (status === "READY" || processingStage === "COMPLETE") return STEPS.length;
  if (!processingStage || processingStage === "QUEUED") return 1;
  return Math.max(1, STEPS.findIndex((step) => step.key === processingStage));
}

export function stepStates(snapshot: ProcessingSnapshot): StepState[] {
  const current = currentStepIndex(snapshot);
  return STEPS.map((_, index) => {
    if (index < current) return "done";
    if (index === current) return snapshot.status === "FAILED" ? "failed" : "active";
    return "pending";
  });
}

export function processingHeadline(snapshot: ProcessingSnapshot): string {
  if (snapshot.status === "FAILED") return "We couldn't finish preparing this book";
  if (snapshot.status === "READY") return "Your book is ready";
  if (snapshot.status === "PROCESSING" && (!snapshot.processingStage || snapshot.processingStage === "QUEUED")) {
    return "Waiting for a free reader…";
  }
  return "Preparing your book…";
}

export function processingLabel(snapshot: ProcessingSnapshot): string {
  const index = Math.min(currentStepIndex(snapshot), STEPS.length - 1);
  if (snapshot.status === "PROCESSING" && (!snapshot.processingStage || snapshot.processingStage === "QUEUED")) return "Queued";
  const step = STEPS[index];
  if (step.key === "EMBEDDING" && snapshot.processingProgress?.total) {
    const percent = Math.round((snapshot.processingProgress.completed / snapshot.processingProgress.total) * 100);
    return `${step.label} · ${percent}%`;
  }
  return step.label;
}

/** Overall ingestion progress (0–1) from the backend stage + embedding progress. */
export function overallProgress(snapshot: ProcessingSnapshot): number {
  const states = stepStates(snapshot);
  const done = states.filter((state) => state === "done").length;
  const progress = snapshot.processingProgress;
  const partial =
    snapshot.processingStage === "EMBEDDING" && progress?.total ? Math.min(1, progress.completed / progress.total) : 0;
  return (done + partial) / STEPS.length;
}
