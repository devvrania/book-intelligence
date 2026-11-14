"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock3, FileText, FileUp, Plus } from "lucide-react";
import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { displayFilename, formatFileSize } from "./format";
import type { UploadItem } from "./use-book-uploads";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const BAR_SPRING = { type: "spring", stiffness: 90, damping: 20 } as const;

interface DropTargetProps {
  uploads: UploadItem[];
  /** Opens the native file picker. */
  onBrowse: () => void;
  /** Files are being dragged somewhere over the page. */
  dragActive: boolean;
  maxUploadMb?: number;
  className?: string;
}

/** Click anywhere on a drop surface to browse (the button stays the accessible control). */
function browseOnSurfaceClick(onBrowse: () => void) {
  return (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, input, [role='progressbar']")) return;
    onBrowse();
  };
}

/** The prominent drop area shown when the library is empty. */
export function UploadDropzone({ uploads, onBrowse, dragActive, maxUploadMb, className }: DropTargetProps) {
  return (
    <div
      onClick={browseOnSurfaceClick(onBrowse)}
      className={cn(
        "group relative isolate cursor-pointer overflow-hidden rounded-[1.75rem] border-[1.5px] border-dashed px-6 py-10 text-center transition-[border-color,background-color,box-shadow,transform] duration-300 sm:px-12 sm:py-12",
        dragActive
          ? "scale-[1.01] border-primary/55 bg-rose-soft/45 shadow-lifted"
          : "border-primary/25 bg-card/75 shadow-soft hover:border-primary/40 hover:bg-card",
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-paper-grain opacity-50" />

      <motion.div
        aria-hidden
        animate={dragActive ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-linear-to-br from-rose-soft to-lavender-soft text-primary shadow-soft ring-1 ring-primary/10"
      >
        <FileUp className="size-6" strokeWidth={1.75} />
      </motion.div>

      <h2 className="mt-5 font-display text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {dragActive ? "Release to add your book" : "Drop a PDF here"}
      </h2>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        or choose one from your device. You can add several at once.
      </p>

      <Button type="button" onClick={onBrowse} className="mt-6 h-11 rounded-full px-6 text-[0.95rem] shadow-lifted">
        <Plus aria-hidden />
        Choose PDF files
      </Button>

      <p className="mt-4 text-xs text-muted-foreground/90">
        PDF only{maxUploadMb ? ` · up to ${maxUploadMb} MB` : ""} · text-based PDFs work best
      </p>

      <UploadList uploads={uploads} className="mx-auto mt-6 max-w-md text-left" />
    </div>
  );
}

/** Rows of in-flight uploads with real, animated progress. */
export function UploadList({ uploads, className }: { uploads: UploadItem[]; className?: string }) {
  return (
    <ul className={cn("space-y-2", uploads.length === 0 && "hidden", className)} aria-label="Uploads">
      <AnimatePresence initial={false}>
        {uploads.map((item) => (
          <motion.li
            key={item.id}
            layout="position"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            className="flex items-center gap-3 rounded-2xl border border-border/80 bg-card px-3.5 py-3 shadow-soft"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors",
                item.state === "done" ? "bg-sage-soft text-sage" : "bg-rose-soft text-primary",
              )}
            >
              {item.state === "done" ? <Check className="size-4" strokeWidth={2.5} /> : <FileText className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-foreground">{displayFilename(item.name)}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{uploadStatusText(item)}</span>
              </div>
              <UploadBar item={item} className="mt-2" />
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function uploadStatusText(item: UploadItem) {
  if (item.state === "queued") return "Waiting…";
  if (item.state === "done") return "Uploaded";
  return `${Math.round(item.progress * 100)}%`;
}

function UploadBar({ item, className }: { item: UploadItem; className?: string }) {
  const percent = Math.round(item.progress * 100);
  return (
    <div
      role="progressbar"
      aria-label={`Uploading ${item.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}
    >
      <motion.div
        className={cn(
          "h-full rounded-full",
          item.state === "done" ? "bg-sage" : "bg-linear-to-r from-primary/70 to-lavender",
        )}
        initial={false}
        animate={{ width: `${percent}%` }}
        transition={BAR_SPRING}
      />
    </div>
  );
}

/** The compact "Add a book" slot at the start of the grid; becomes the upload card while sending. */
export function AddBookTile({ uploads, onBrowse, dragActive, maxUploadMb, className }: DropTargetProps) {
  const current =
    uploads.find((item) => item.state === "uploading") ??
    uploads.find((item) => item.state === "queued") ??
    uploads.at(-1);
  const waiting = uploads.filter((item) => item.state === "queued" && item !== current).length;

  return (
    <div
      onClick={current ? undefined : browseOnSurfaceClick(onBrowse)}
      className={cn(
        "group/tile relative aspect-[2/3] overflow-hidden rounded-[3px_8px_8px_3px] border-[1.5px] border-dashed transition-[border-color,background-color,box-shadow] duration-300 has-focus-visible:border-ring has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
        dragActive
          ? "border-primary/60 bg-rose-soft/50 shadow-lifted"
          : current
            ? "border-primary/25 bg-card shadow-soft"
            : "border-primary/20 bg-card/60 hover:border-primary/40 hover:bg-blush/80",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {current ? (
          <motion.div
            key="uploading"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.25, ease: EASE_OUT }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-4 text-center"
          >
            <ProgressRing item={current} />
            <div className="w-full min-w-0">
              <p className="line-clamp-2 font-display text-sm leading-snug font-semibold break-words text-foreground">
                {displayFilename(current.name)}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                {current.state === "done"
                  ? "Added to the library"
                  : current.state === "queued"
                    ? "Waiting to upload"
                    : `${formatFileSize(current.progress * current.size)} of ${formatFileSize(current.size)}`}
              </p>
              {waiting > 0 && (
                <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  <Clock3 aria-hidden className="size-3" />
                  {waiting} more waiting
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onBrowse}
              className="absolute bottom-3 rounded-full px-2 py-0.5 text-[11px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Add another
            </button>
            <span className="sr-only" aria-live="polite">
              {current.state === "done" ? `${current.name} uploaded` : `Uploading ${current.name}`}
            </span>
          </motion.div>
        ) : (
          <motion.button
            key="idle"
            type="button"
            onClick={onBrowse}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center outline-none"
          >
            <motion.span
              aria-hidden
              animate={dragActive ? { y: -4, scale: 1.1 } : { y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="flex size-11 items-center justify-center rounded-full bg-rose-soft text-primary shadow-soft ring-1 ring-primary/10 transition-transform duration-300 group-hover/tile:scale-105"
            >
              <Plus className="size-5" />
            </motion.span>
            <span className="font-display text-[0.95rem] font-semibold text-foreground">
              {dragActive ? "Drop to add" : "Add a book"}
            </span>
            <span className="text-xs leading-relaxed text-muted-foreground">
              Drop a PDF here
              <br />
              or click to browse
            </span>
            {maxUploadMb && <span className="text-[10px] text-muted-foreground/75">Up to {maxUploadMb} MB</span>}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProgressRing({ item }: { item: UploadItem }) {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(item.progress * 100);
  const done = item.state === "done";

  return (
    <div
      role="progressbar"
      aria-label={`Uploading ${item.name}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="relative size-16"
    >
      <svg viewBox="0 0 52 52" className="size-full -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r={radius} fill="none" strokeWidth="3" className="stroke-muted" />
        <motion.circle
          cx="26"
          cy="26"
          r={radius}
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={circumference}
          className={cn("transition-colors duration-500", done ? "stroke-sage" : "stroke-primary")}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - item.progress) }}
          transition={BAR_SPRING}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-foreground tabular-nums">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span
              key="done"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex size-8 items-center justify-center rounded-full bg-sage-soft text-sage"
            >
              <Check className="size-4" strokeWidth={2.75} />
            </motion.span>
          ) : (
            <motion.span key="percent" exit={{ opacity: 0 }}>
              {item.state === "queued" ? "—" : `${percent}%`}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}

/** Full-page veil shown while files are dragged over a library that has books. */
export function DropOverlay({ active }: { active: boolean }) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          aria-hidden
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-6 backdrop-blur-sm"
        >
          <div className="absolute inset-3 rounded-[2rem] border-2 border-dashed border-primary/40 bg-editorial-wash sm:inset-5" />
          <motion.div
            initial={{ y: 10, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 6, scale: 0.98 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
            className="relative text-center"
          >
            <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-card text-primary shadow-lifted ring-1 ring-primary/10">
              <FileUp className="size-7" strokeWidth={1.75} />
            </div>
            <p className="mt-6 font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Drop to add to the library
            </p>
            <p className="mt-2 text-sm text-muted-foreground">PDF files only — we’ll take it from there.</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
