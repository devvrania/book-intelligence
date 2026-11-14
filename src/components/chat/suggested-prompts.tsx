"use client";

import { motion } from "framer-motion";
import { Compass, Feather, Lightbulb, Scale, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SuggestedQuestion, SuggestionCategory } from "@/types/domain";

const CATEGORIES: { key: SuggestionCategory; label: string; icon: LucideIcon; tint: string }[] = [
  { key: "understand", label: "Understand", icon: Lightbulb, tint: "bg-rose-soft text-accent-foreground" },
  { key: "explore", label: "Explore", icon: Compass, tint: "bg-lavender-soft text-secondary-foreground" },
  { key: "compare", label: "Compare", icon: Scale, tint: "bg-amber-soft text-amber" },
  { key: "reflect", label: "Reflect", icon: Feather, tint: "bg-sage-soft text-sage" },
];

const FALLBACK: SuggestedQuestion[] = [
  { category: "understand", question: "What is this book mainly about?" },
  { category: "understand", question: "What are the most important arguments?" },
  { category: "explore", question: "Explain the main themes." },
  { category: "explore", question: "Summarize chapter 3." },
  { category: "compare", question: "Compare the ideas in chapters 2 and 7." },
  { category: "reflect", question: "What does the author suggest about human nature?" },
];

export function SuggestedPrompts({
  questions,
  onPick,
  compact,
}: {
  questions?: SuggestedQuestion[] | null;
  onPick: (question: string) => void;
  compact?: boolean;
}) {
  const list = questions && questions.length >= 3 ? questions : FALLBACK;
  const groups = CATEGORIES.map((category) => ({
    ...category,
    questions: list.filter((q) => q.category === category.key).slice(0, compact ? 1 : 2),
  })).filter((group) => group.questions.length > 0);

  return (
    <div className={cn("grid gap-3", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
      {groups.map((group, groupIndex) => (
        <motion.div
          key={group.key}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 * groupIndex, duration: 0.35, ease: "easeOut" }}
          className="rounded-2xl border border-border/80 bg-card/80 p-3 shadow-soft"
        >
          <div className="mb-2 flex items-center gap-2 px-1">
            <span className={cn("flex size-6 items-center justify-center rounded-lg", group.tint)}>
              <group.icon className="size-3.5" aria-hidden />
            </span>
            <span className="text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">{group.label}</span>
          </div>
          <div className="grid gap-1">
            {group.questions.map((q) => (
              <button
                key={q.question}
                type="button"
                onClick={() => onPick(q.question)}
                className="rounded-xl px-2.5 py-2 text-left text-sm leading-snug text-foreground/90 transition hover:bg-blush hover:text-foreground focus-visible:bg-blush focus-visible:outline-none"
              >
                {q.question}
              </button>
            ))}
          </div>
        </motion.div>
      ))}
    </div>
  );
}
