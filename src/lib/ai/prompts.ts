import type { ConversationSummary } from "./types";

/**
 * Prompt text shared between the primary provider (Gemini, schema-
 * constrained via lib/ai/client.ts) and the fallback provider (OpenRouter,
 * lib/ai/fallback.ts, which only gets loose JSON-object mode). The JSON
 * shape is spelled out in the instruction text itself — redundant for
 * Gemini, which enforces it via responseSchema anyway, but required for the
 * fallback path since a free-tier model has nothing else constraining its
 * output. Keeping this in one file means the two providers can never drift
 * into answering a differently-worded prompt.
 */

export const SUMMARY_SYSTEM_INSTRUCTION = `You summarize customer support conversations for a support agent who is
about to pick one up. Be concrete and specific — quote the customer's actual
words where it helps, never pad with generic filler. If a rolling summary of
everything before the new messages is provided, treat it as ground truth and
UPDATE it with what the new messages add or change; do not re-derive it from
scratch or drop details it already established. Respond with the sentiment of
the CUSTOMER (not the agent) as expressed in the most recent messages.

Respond with ONLY a JSON object, no other text, no markdown fence, of exactly
this shape:
{"what_user_wants": string, "whats_been_tried": string, "current_status": string, "sentiment": "positive" | "neutral" | "negative" | "frustrated", "suggested_next_step": string}`;

export const DRAFT_SYSTEM_INSTRUCTION = `You draft reply messages for a customer support agent — write as the
agent, first person, addressing the customer directly. Base the reply ONLY
on the conversation so far and the help-article excerpts provided; never
invent a policy, price, timeline, or fact that isn't in either. If nothing
provided actually answers the customer's question, write a brief reply
acknowledging what they asked and saying you're looking into it rather than
guessing. This text is inserted directly into the agent's reply box, so:
plain text only (no markdown, no subject line), and skip a greeting or
sign-off unless the conversation's own tone clearly calls for one — the
agent may still want to edit it before sending.

Respond with ONLY a JSON object, no other text, no markdown fence, of exactly
this shape:
{"draft_reply": string}`;

export interface SummarizeInput {
  previousSummary: ConversationSummary | null;
  newMessages: { authorType: string; bodyText: string }[];
  contactName: string | null;
}

export function buildSummaryPrompt({
  previousSummary,
  newMessages,
  contactName,
}: SummarizeInput): string {
  const parts: string[] = [];

  parts.push(`Customer: ${contactName ?? "unknown"}`);

  if (previousSummary) {
    parts.push(
      "Existing summary (covers everything before the new messages below):",
      JSON.stringify(previousSummary, null, 2),
    );
  }

  parts.push(
    previousSummary ? "New messages since that summary:" : "Conversation so far:",
    newMessages.map((m) => `[${m.authorType}] ${m.bodyText}`).join("\n"),
  );

  return parts.join("\n\n");
}

export interface DraftReplyInput {
  messages: { authorType: string; bodyText: string }[];
  contactName: string | null;
  articles: { title: string; content: string }[];
}

export function buildDraftPrompt({ messages, contactName, articles }: DraftReplyInput): string {
  const parts: string[] = [];
  parts.push(`Customer: ${contactName ?? "unknown"}`);
  parts.push(
    "Conversation so far:",
    messages.map((m) => `[${m.authorType}] ${m.bodyText}`).join("\n"),
  );
  if (articles.length > 0) {
    parts.push(
      "Relevant help articles (use only if actually relevant):",
      articles.map((a) => `- ${a.title}${a.content ? `: ${a.content}` : ""}`).join("\n"),
    );
  }
  return parts.join("\n\n");
}
