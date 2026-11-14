import type { ChatProvider } from "@/lib/ai";
import { truncate } from "@/lib/documents/text-utils";
import { logger } from "@/lib/logger";

export interface HistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Turns a conversational follow-up ("why did she refuse him?") into a
 * standalone search query using the recent conversation. Only the retrieval
 * query is rewritten — the model still answers the reader's original words.
 */
export class QueryRewriter {
  constructor(private readonly utility: ChatProvider | null) {}

  async rewrite(
    question: string,
    history: HistoryTurn[],
  ): Promise<{ query: string; rewritten: boolean; byModel: boolean }> {
    if (history.length === 0) return { query: question, rewritten: false, byModel: false };

    const lastUser = [...history].reverse().find((turn) => turn.role === "user")?.content ?? "";
    // Without a model, anchor retrieval on the previous question as well.
    const fallback = { query: `${truncate(lastUser, 300)} ${question}`.trim(), rewritten: true, byModel: false };
    if (!this.utility) return fallback;

    const transcript = history
      .slice(-4)
      .map((turn) => `${turn.role === "user" ? "Reader" : "Assistant"}: ${truncate(turn.content.replace(/\[S\d+\]/g, ""), 500)}`)
      .join("\n");

    try {
      const completion = await this.utility.complete({
        maxOutputTokens: 120,
        messages: [
          {
            role: "system",
            content:
              "Rewrite the reader's follow-up question as a standalone search query for finding passages in the book. " +
              "Use the conversation only to resolve references (pronouns, 'that', 'it', 'the other one'). " +
              "Keep names, chapter numbers and key terms. Output only the query, under 30 words, without quotes.",
          },
          { role: "user", content: `Conversation:\n${transcript}\n\nFollow-up question: ${question}` },
        ],
      });
      const query = completion.text.trim().replace(/^["']|["']$/g, "");
      if (!query || query.length > 400) return fallback;
      return { query, rewritten: true, byModel: true };
    } catch (error) {
      logger.warn("retrieval.rewrite_failed", { error });
      return fallback;
    }
  }
}
