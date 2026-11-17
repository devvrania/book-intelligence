"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, History, SquarePen } from "lucide-react";

import { formatRelativeTime } from "@/components/library/format";
import { useNow } from "@/components/library/hooks";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/features/api/client";
import { chatKeys } from "@/features/chat/use-chat-session";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/types/api";

/**
 * Above the chat: start a new chat, or switch to one of this visitor's earlier chats about the book (chats are
 * private, so the list only ever holds their own). Hidden until they've asked something.
 */
export function ChatToolbar({
  bookId,
  activeId,
  hasMessages,
  disabled,
  onSelect,
}: {
  bookId: string;
  activeId: string | null;
  hasMessages: boolean;
  disabled: boolean;
  onSelect: (conversationId: string | null) => void;
}) {
  const now = useNow();
  const { data } = useQuery({
    queryKey: chatKeys.conversations(bookId),
    queryFn: () => api<{ conversations: ConversationSummary[] }>(`/api/conversations?bookId=${bookId}`),
    staleTime: 30_000,
  });
  const chats = data?.conversations ?? [];
  if (chats.length === 0 && !hasMessages) return null;

  const active = chats.find((chat) => chat.id === activeId);

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2 sm:px-8">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled || chats.length === 0}>
            <button
              type="button"
              className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <History className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{active ? active.title : hasMessages ? "New chat" : "Your chats"}</span>
              {chats.length > 0 && <ChevronDown className="size-3.5 shrink-0" aria-hidden />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Your chats about this book</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.id} onSelect={() => onSelect(chat.id)} className="items-start gap-2">
                <Check className={cn("mt-0.5 size-3.5 shrink-0", chat.id === activeId ? "opacity-100" : "opacity-0")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm">{chat.title}</span>
                  <span className="text-xs text-muted-foreground">{formatRelativeTime(chat.lastMessageAt, now)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={() => onSelect(null)}
          disabled={disabled || !hasMessages}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/80 bg-card px-3 py-1 text-xs font-medium text-foreground shadow-soft transition hover:border-primary/30 disabled:pointer-events-none disabled:opacity-50"
        >
          <SquarePen className="size-3.5" aria-hidden /> New chat
        </button>
      </div>
    </div>
  );
}
