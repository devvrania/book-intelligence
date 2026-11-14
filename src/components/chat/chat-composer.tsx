"use client";

import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  placeholder: string;
  isStreaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}

/** The question box: Enter sends, Shift+Enter adds a line; while an answer streams, the button stops it. */
export function ChatComposer({ placeholder, isStreaming, onSend, onStop }: ChatComposerProps) {
  const [value, setValue] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || isStreaming) return;
    onSend(text);
    setValue("");
  };

  return (
    <>
      <div className="flex items-end gap-2 rounded-3xl border border-border bg-card p-2 pl-0 shadow-lifted transition focus-within:border-primary/30 focus-within:ring-4 focus-within:ring-primary/8">
        <textarea
          ref={textarea}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder={placeholder}
          aria-label="Your question"
          className="block min-h-9 w-full resize-none bg-transparent px-4 py-1.5 text-[0.95rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        {isStreaming ? (
          <Button type="button" size="icon" variant="secondary" className="size-9 shrink-0 rounded-full" onClick={onStop} aria-label="Stop answering">
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="size-9 shrink-0 rounded-full shadow-soft"
            onClick={submit}
            disabled={!value.trim()}
            aria-label="Ask"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
      {/* there are no accounts, so every conversation is visible in the shared library */}
      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Chats are public: anyone who opens this book can read them. Answers can be imperfect, so check the sources.
      </p>
    </>
  );
}
