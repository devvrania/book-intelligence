"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useChatSession } from "@/features/chat/use-chat-session";
import { cn } from "@/lib/utils";
import type { BookDetail, SourceDTO } from "@/types/api";

import { AssistantMessage, UserMessage } from "./chat-message";
import { ChatComposer } from "./chat-composer";
import { ChatToolbar } from "./chat-toolbar";
import { PassageSheet } from "./passage-sheet";
import { SuggestedPrompts } from "./suggested-prompts";

export interface ChatPanelProps {
  book: BookDetail;
  /** This visitor's latest chat about the book, if they've asked anything: chats are private to each browser. */
  initialConversationId?: string | null;
  className?: string;
}

/** Ask the book: this visitor's private chats about it, answers with citations you can open. */
export function ChatPanel({ book, initialConversationId = null, className }: ChatPanelProps) {
  const [openSource, setOpenSource] = useState<SourceDTO | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const session = useChatSession({ bookId: book.id, initialConversationId });

  const ask = useCallback(
    (question: string) => {
      stickToBottom.current = true;
      void session.send(question);
    },
    [session],
  );

  // Follow the answer as it streams, unless the reader scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (!el || session.messages.length === 0 || !stickToBottom.current) return;
    el.scrollTo({ top: el.scrollHeight, behavior: session.isStreaming ? "auto" : "smooth" });
  }, [session.messages, session.isStreaming]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const lastUser = [...session.messages].reverse().find((message) => message.role === "user");
  const isEmpty = session.messages.length === 0 && !session.isLoadingHistory;

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <ChatToolbar
        bookId={book.id}
        activeId={session.conversationId}
        hasMessages={session.messages.length > 0}
        disabled={session.isStreaming}
        onSelect={(id) => {
          stickToBottom.current = true;
          session.selectConversation(id);
        }}
      />
      <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
          {session.isLoadingHistory ? (
            <div className="space-y-6" aria-label="Loading conversation">
              <Skeleton className="ml-auto h-10 w-2/3 rounded-3xl" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-11/12" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          ) : isEmpty ? (
            <div className="pt-6 sm:pt-12">
              <p className="text-[11px] font-semibold tracking-[0.2em] text-primary uppercase">Ask AI</p>
              <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                What would you like to explore?
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Ask anything about {book.title}. Answers come only from the book, with citations to the chapter and page.
              </p>
              <div className="mt-8">
                <SuggestedPrompts questions={book.insights?.suggestedQuestions} onPick={ask} />
              </div>
            </div>
          ) : (
            <div className="space-y-7" aria-live="polite">
              {session.messages.map((message) =>
                message.role === "user" ? (
                  <UserMessage key={message.id} message={message} />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    onOpenSource={setOpenSource}
                    onRetry={
                      message.status === "error" && lastUser && !session.isStreaming
                        ? () => ask(lastUser.content)
                        : undefined
                    }
                  />
                ),
              )}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-border/40 bg-gradient-to-t from-background via-background to-background/70 px-4 pt-3 pb-4 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer
            placeholder={`Ask anything about ${book.title}…`}
            isStreaming={session.isStreaming}
            onSend={ask}
            onStop={session.stop}
          />
        </div>
      </div>

      <PassageSheet bookId={book.id} source={openSource} onOpenChange={(open) => !open && setOpenSource(null)} />
    </div>
  );
}
