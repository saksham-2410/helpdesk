import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { summarizeConversation } from "./client";
import { listMessages } from "@/lib/inbox/data";
import { features } from "@/lib/env";
import type { ConversationSummary, SummaryResult } from "./types";

const MIN_MESSAGES = 6;

interface CachedRow {
  summary: ConversationSummary;
  up_to_message_id: string | null;
  generated_at: string;
}

/**
 * Fetches (and, if the cache is behind the latest message, extends) the
 * conversation summary. Never throws: a failed generation falls back to the
 * last good cache with `stale: true`, or to `null` if there is no cache yet
 * — an inbox that can't summarize must still open normally, per the
 * "fallback handling when the API is slow or fails" requirement.
 */
export async function getConversationSummary(
  supabase: SupabaseClient,
  conversationId: string,
  workspaceId: string,
  contactName: string | null,
): Promise<SummaryResult | null> {
  const messages = await listMessages(supabase, conversationId);
  if (messages.length < MIN_MESSAGES) return null;

  const { data: cached } = await supabase
    .from("conversation_summaries")
    .select("summary, up_to_message_id, generated_at")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  const row = cached as CachedRow | null;
  const latestMessage = messages[messages.length - 1]!;

  if (row && row.up_to_message_id === latestMessage.id) {
    return { summary: row.summary, generatedAt: row.generated_at, stale: false };
  }

  // client.ts owns the decision of whether Gemini itself is worth trying
  // right now (its own circuit breaker) and, if not, whether a fallback
  // provider can stand in — this only needs to know "is AI configured at
  // all" before bothering to call it.
  if (!features.ai) {
    return row ? { summary: row.summary, generatedAt: row.generated_at, stale: true } : null;
  }

  const sinceIndex = row?.up_to_message_id
    ? messages.findIndex((m) => m.id === row.up_to_message_id) + 1
    : 0;
  const newMessages = messages.slice(sinceIndex < 0 ? 0 : sinceIndex);

  // A stale up_to pointer (e.g. that message was since deleted) with
  // genuinely nothing new to add — the cache is still the right answer.
  if (newMessages.length === 0 && row) {
    return { summary: row.summary, generatedAt: row.generated_at, stale: false };
  }

  try {
    const { summary, model } = await summarizeConversation({
      previousSummary: row?.summary ?? null,
      newMessages: newMessages.map((m) => ({ authorType: m.author_type, bodyText: m.body_text })),
      contactName,
    });

    const generatedAt = new Date().toISOString();
    await supabase.from("conversation_summaries").upsert({
      conversation_id: conversationId,
      workspace_id: workspaceId,
      summary,
      up_to_message_id: latestMessage.id,
      model,
      generated_at: generatedAt,
    });

    return { summary, generatedAt, stale: false };
  } catch (err) {
    console.error("[ai] summarizeConversation failed", err);
    return row ? { summary: row.summary, generatedAt: row.generated_at, stale: true } : null;
  }
}
