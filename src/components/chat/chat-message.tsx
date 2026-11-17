"use client";

import { motion } from "framer-motion";
import { AlertCircle, BookX, Check, Copy, Quote, RotateCcw, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";

import { truncate } from "@/lib/documents/text-utils";
import { cn } from "@/lib/utils";
import type { SourceDTO } from "@/types/api";
import type { ChatMessage as ChatMessageModel } from "@/features/chat/use-chat-session";

import { MarkdownAnswer } from "./markdown-answer";
import { SourcesList } from "./sources-list";

const STAGE_COPY = {
  understanding: "Understanding your question…",
  retrieving: "Searching the book…",
  generating: "Reading the passages…",
  checking: "Checking the answer against the book…",
} as const;

export function UserMessage({ message }: { message: ChatMessageModel }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
      <div className="max-w-[85%] space-y-1.5">
        {message.selection && (message.selection.text || message.selection.pageNumber) && (
          <div className="flex items-start gap-1.5 rounded-2xl border border-border/70 bg-card px-3 py-2 text-xs text-muted-foreground">
            <Quote className="mt-0.5 size-3 shrink-0 text-primary" aria-hidden />
            <span className="font-reading text-[0.85rem] leading-snug italic">
              {message.selection.text ? `“${truncate(message.selection.text, 180)}”` : `About page ${message.selection.pageNumber}`}
            </span>
          </div>
        )}
        <div className="rounded-3xl rounded-br-lg bg-gradient-to-br from-rose-soft to-blush px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap text-foreground shadow-soft">
          {message.content}
        </div>
      </div>
    </motion.div>
  );
}

export function AssistantMessage({
  message,
  onOpenSource,
  onRetry,
  compact,
}: {
  message: ChatMessageModel;
  onOpenSource: (source: SourceDTO) => void;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const thinking = message.streaming && !message.content;
  const isError = message.status === "error";

  const copy = async () => {
    await navigator.clipboard.writeText(message.content.replace(/\[S\d+\]/g, "").replace(/[ \t]+([.,;:!?])/g, "$1"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3">
      <div
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full shadow-soft",
          isError ? "bg-destructive/10 text-destructive" : "bg-gradient-to-br from-primary/90 to-lavender text-primary-foreground",
        )}
        aria-hidden
      >
        {isError ? <AlertCircle className="size-3.5" /> : <Sparkles className="size-3.5" />}
      </div>

      <div className="min-w-0 flex-1">
        {thinking ? (
          <ThinkingIndicator stage={message.stage ?? "understanding"} sourceCount={message.sources.length} />
        ) : isError ? (
          <div className="rounded-2xl border border-destructive/15 bg-destructive/5 px-4 py-3 text-sm text-foreground">
            <p>{message.content}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <RotateCcw className="size-3" /> Try again
              </button>
            )}
          </div>
        ) : (
          <>
            <MarkdownAnswer content={message.content} sources={message.sources} onOpenSource={onOpenSource} />
            {message.streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-full bg-primary/50 align-middle" aria-hidden />}
          </>
        )}

        {!isError && !message.streaming && <GroundingNote grounding={message.grounding} />}

        {!isError && !thinking && !message.streaming && message.sources.length > 0 && (
          <SourcesList sources={message.sources} onOpen={onOpenSource} compact={compact} />
        )}

        {!isError && !message.streaming && message.content && !message.content.startsWith("_Stopped") && (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

/**
 * A small note under the answer when it isn't a normal cited answer: an honest "not in the book" refusal, or an
 * answer the model gave without citations even after a retry (so the reader should check the passages).
 */
function GroundingNote({ grounding }: { grounding?: ChatMessageModel["grounding"] }) {
  if (grounding === "not_in_book") {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
        <BookX className="size-3.5" aria-hidden /> Not covered in this book
      </p>
    );
  }
  if (grounding === "uncited") {
    return (
      <p className="mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
        <ShieldAlert className="mt-px size-3.5 shrink-0" aria-hidden />
        This answer isn’t backed by citations, so it may include things the book doesn’t say. Check the passages below.
      </p>
    );
  }
  return null;
}

function ThinkingIndicator({ stage, sourceCount }: { stage: keyof typeof STAGE_COPY; sourceCount: number }) {
  const label = stage === "generating" && sourceCount > 0 ? `Reading ${sourceCount} passages…` : STAGE_COPY[stage];
  return (
    <div className="flex items-center gap-2.5 py-1" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-primary/60"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15 }}
          />
        ))}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
