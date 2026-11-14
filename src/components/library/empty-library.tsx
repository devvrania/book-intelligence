"use client";

import { motion } from "framer-motion";
import { DoorOpen, Plus, Quote, Sparkles } from "lucide-react";

import { BookCover } from "@/components/books/book-cover";

import { UploadDropzone } from "./upload-dropzone";
import type { UploadItem } from "./use-book-uploads";

const EASE_OUT = [0.22, 1, 0.36, 1] as const;

const PROMISES = [
  { icon: DoorOpen, label: "No sign-up needed" },
  { icon: Quote, label: "Answers cite chapter & page" },
  { icon: Sparkles, label: "Ready in about a minute" },
] as const;

interface EmptyLibraryProps {
  uploads: UploadItem[];
  onBrowse: () => void;
  dragActive: boolean;
  maxUploadMb?: number;
}

/** First-run state: an illustrated shelf and a prominent place to drop a book. */
export function EmptyLibrary({ uploads, onBrowse, dragActive, maxUploadMb }: EmptyLibraryProps) {
  return (
    <section aria-labelledby="empty-library-title" className="mx-auto mt-6 max-w-2xl text-center sm:mt-10">
      <ShelfIllustration lifted={dragActive} />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: EASE_OUT }}
      >
        <h2
          id="empty-library-title"
          className="mt-10 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-[2.6rem] sm:leading-tight"
        >
          Your shelves are waiting
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
          Add a book you love — a novel, a textbook, a collection of essays — and ask it anything. Every answer
          points to the exact page it came from.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.25, ease: EASE_OUT }}
        className="mt-10"
      >
        <UploadDropzone uploads={uploads} onBrowse={onBrowse} dragActive={dragActive} maxUploadMb={maxUploadMb} />
      </motion.div>

      <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
        {PROMISES.map(({ icon: Icon, label }) => (
          <li key={label} className="inline-flex items-center gap-1.5">
            <Icon aria-hidden className="size-3.5 text-sage" />
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Two generated covers leaning on an empty, dashed slot — "your book goes here". */
function ShelfIllustration({ lifted }: { lifted: boolean }) {
  return (
    <div aria-hidden className="relative mx-auto h-48 w-72 sm:h-56 sm:w-80">
      <div className="absolute inset-x-0 top-6 bottom-0 rounded-full bg-editorial-wash blur-2xl" />

      <motion.div
        className="absolute bottom-4 left-3 w-24 sm:left-2 sm:w-28"
        initial={{ opacity: 0, y: 20, rotate: -14 }}
        animate={{ opacity: 1, y: 0, rotate: -9 }}
        transition={{ duration: 0.8, ease: EASE_OUT }}
      >
        <BookCover title="Emma" author="Austen" seed="middlemarch" size="md" />
      </motion.div>

      <motion.div
        className="absolute bottom-6 left-1/2 z-10 w-28 -translate-x-1/2 sm:w-32"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: lifted ? -6 : 0 }}
        transition={{ duration: 0.8, delay: 0.08, ease: EASE_OUT }}
      >
        <BookCover title="Little Women" author="L. M. Alcott" seed="little-women-1" size="md" />
      </motion.div>

      <motion.div
        className="absolute right-1 bottom-4 flex aspect-[2/3] w-24 items-center justify-center pl-[18%] rounded-[3px_8px_8px_3px] border-[1.5px] border-dashed border-primary/35 bg-card/80 shadow-soft sm:right-0 sm:w-28"
        initial={{ opacity: 0, y: 20, rotate: 12 }}
        animate={{ opacity: 1, y: lifted ? -8 : 0, rotate: lifted ? 4 : 7 }}
        transition={{ duration: 0.8, delay: 0.16, ease: EASE_OUT }}
      >
        <span className="flex size-9 items-center justify-center rounded-full bg-rose-soft text-primary">
          <Plus className="size-4" />
        </span>
      </motion.div>

      {/* the shelf */}
      <div className="absolute inset-x-2 bottom-2 h-[3px] rounded-full bg-linear-to-r from-transparent via-border to-transparent" />
    </div>
  );
}
