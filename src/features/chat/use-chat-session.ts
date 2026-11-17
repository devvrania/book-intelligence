"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api, ApiError } from "@/features/api/client";
import type { MessageDTO } from "@/types/api";

import { streamChat } from "./stream";

export type ChatStage = "understanding" | "retrieving" | "generating" | "checking";

/** A message as rendered: server messages plus local streaming state. */
export interface ChatMessage extends MessageDTO {
  streaming?: boolean;
  stage?: ChatStage;
}

export const chatKeys = {
  conversations: (bookId: string) => ["conversations", bookId] as const,
  messages: (conversationId: string) => ["conversation-messages", conversationId] as const,
};

export interface SendOptions {
  chapterId?: string | null;
  selection?: { text?: string; pageNumber?: number } | null;
}

let localId = 0;
const tempId = (prefix: string) => `${prefix}-${Date.now()}-${localId++}`;

/**
 * State for one conversation about a book:
 * load history → send (optimistic) → stream status/sources/deltas → final message.
 */
export function useChatSession({
  bookId,
  initialConversationId = null,
  onConversationChange,
}: {
  bookId: string;
  initialConversationId?: string | null;
  onConversationChange?: (conversationId: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId);
  // A conversation created by our own stream: its history is already on screen.
  const [createdHere, setCreatedHere] = useState<string | null>(null);
  // Turns added in this session (optimistic + streamed), layered over server history.
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const history = useQuery({
    queryKey: chatKeys.messages(conversationId ?? "none"),
    queryFn: () => api<{ messages: MessageDTO[] }>(`/api/conversations/${conversationId}/messages`),
    enabled: !!conversationId && conversationId !== createdHere,
    staleTime: 30_000,
  });

  const messages = useMemo<ChatMessage[]>(() => {
    if (!conversationId || conversationId === createdHere) return local;
    const server = history.data?.messages ?? [];
    const seen = new Set(server.map((message) => message.id));
    return [...server, ...local.filter((message) => !seen.has(message.id))];
  }, [conversationId, createdHere, history.data, local]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const selectConversation = useCallback(
    (id: string | null) => {
      abortRef.current?.abort();
      setCreatedHere(null);
      setLocal([]);
      setConversationId(id);
      onConversationChange?.(id);
    },
    [onConversationChange],
  );

  const patchMessage = useCallback((id: string, patch: (message: ChatMessage) => ChatMessage) => {
    setLocal((current) => current.map((message) => (message.id === id ? patch(message) : message)));
  }, []);

  const send = useCallback(
    async (text: string, options: SendOptions = {}) => {
      const content = text.trim();
      if (!content || isStreaming) return;

      const now = new Date().toISOString();
      const selection = options.selection ?? null;
      const userTemp: ChatMessage = {
        id: tempId("user"),
        role: "user",
        content,
        status: "complete",
        createdAt: now,
        sources: [],
        selection: selection ? { text: selection.text ?? "", pageNumber: selection.pageNumber } : null,
      };
      const assistantId = tempId("assistant");
      setLocal((current) => [
        ...current,
        userTemp,
        { id: assistantId, role: "assistant", content: "", status: "complete", createdAt: now, sources: [], streaming: true, stage: "understanding" },
      ]);
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;
      let activeConversation = conversationId;
      const existingConversation = !!conversationId && conversationId !== createdHere;
      let started = false;
      let finished = false;

      try {
        await streamChat(
          bookId,
          { message: content, conversationId, chapterId: options.chapterId ?? null, selection },
          {
            signal: controller.signal,
            onEvent: (event) => {
              switch (event.type) {
                case "conversation":
                  started = true;
                  patchMessage(userTemp.id, () => ({ ...event.userMessage }));
                  if (!activeConversation) {
                    activeConversation = event.conversation.id;
                    setCreatedHere(event.conversation.id);
                    setConversationId(event.conversation.id);
                    onConversationChange?.(event.conversation.id);
                  }
                  break;
                case "status":
                  patchMessage(assistantId, (message) => ({ ...message, stage: event.stage }));
                  break;
                case "sources":
                  patchMessage(assistantId, (message) => ({ ...message, sources: event.sources }));
                  break;
                case "delta":
                  patchMessage(assistantId, (message) => ({ ...message, stage: "generating", content: message.content + event.text }));
                  break;
                case "reset":
                  // the draft cited nothing; a stricter attempt replaces it
                  patchMessage(assistantId, (message) => ({ ...message, content: "", stage: "checking" }));
                  break;
                case "done":
                  finished = true;
                  patchMessage(assistantId, () => ({ ...event.message }));
                  break;
                case "error":
                  finished = true;
                  patchMessage(assistantId, (message) => ({
                    ...message,
                    streaming: false,
                    status: "error",
                    content: event.message,
                    sources: [],
                  }));
                  break;
              }
            },
          },
        );
        if (!finished) patchMessage(assistantId, (message) => ({ ...message, streaming: false }));
      } catch (error) {
        if (controller.signal.aborted) {
          // Stopped by the reader: keep whatever was written so far.
          patchMessage(assistantId, (message) => ({ ...message, streaming: false, content: message.content || "_Stopped._" }));
        } else {
          const messageText =
            error instanceof ApiError ? error.message : "We couldn't reach Book Intelligence. Check your connection and try again.";
          patchMessage(assistantId, (message) => ({ ...message, streaming: false, status: "error", content: messageText }));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setIsStreaming(false);
        void queryClient.invalidateQueries({ queryKey: chatKeys.conversations(bookId) });
        if (activeConversation && existingConversation && started) {
          // The server now has these turns (including partial or error answers): make it the source of truth.
          await queryClient.invalidateQueries({ queryKey: chatKeys.messages(activeConversation) });
          setLocal([]);
        }
      }
    },
    [bookId, conversationId, createdHere, isStreaming, onConversationChange, patchMessage, queryClient],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  return {
    conversationId,
    messages,
    isStreaming,
    isLoadingHistory: !!conversationId && conversationId !== createdHere && history.isLoading,
    historyError: history.error,
    send,
    stop,
    selectConversation,
  };
}
