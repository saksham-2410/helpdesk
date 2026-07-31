import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConversationSummary } from "./summarize";
import { features } from "@/lib/env";

/**
 * Moves summary generation from read-time to write-time. Without this,
 * opening any conversation whose cache is behind the latest message pays
 * for a live Gemini/OpenRouter call in the request path — fine for one
 * agent opening one conversation, but it means read latency scales with
 * how many conversations get *opened*, not how many messages get *sent*,
 * which is backwards for a support inbox where reads vastly outnumber
 * writes.
 *
 * Called from every message-insert site (chat reply, email reply, widget
 * message, inbound webhook) with next/server's `after()` — the response to
 * whoever triggered the insert goes out immediately, and generation runs
 * afterward in the same invocation. By the time an agent next opens the
 * conversation, getConversationSummary()'s existing cache check is very
 * likely already a hit.
 *
 * Deliberately NOT a replacement for the on-demand path in summarize.ts —
 * that stays exactly as it was, and is what actually serves the request if
 * this background refresh never ran (AI not configured, or the invocation
 * got recycled before `after()` finished — a soft-fail either way: the
 * conversation just falls back to the previous cache, or generates
 * on-demand next time it's opened, exactly like today).
 */
export function scheduleSummaryRefresh(
  supabase: SupabaseClient,
  conversationId: string,
  workspaceId: string,
): void {
  if (!features.ai) return;

  after(async () => {
    try {
      const { data } = await supabase
        .from("conversations")
        .select("contact:contacts(name, email)")
        .eq("id", conversationId)
        .maybeSingle();
      const contact = Array.isArray(data?.contact) ? data.contact[0] : data?.contact;
      const contactName = contact?.name ?? contact?.email ?? null;

      await getConversationSummary(supabase, conversationId, workspaceId, contactName);
    } catch (err) {
      // getConversationSummary itself never throws (it catches and falls
      // back to stale-cache internally) — this guards the contact lookup
      // and is otherwise unreachable, but a background task silently
      // swallowing an unexpected error with no trace at all would be worse
      // than one console.error line.
      console.error("[ai] scheduleSummaryRefresh failed", err);
    }
  });
}
