"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { sendReply } from "@/lib/email/send";
import { broadcast } from "@/lib/widget/realtime";

export interface ActionState {
  error?: string;
}

/**
 * Authorization for every mutation here is RLS, via the caller's own
 * session client — there is no separate workspace/permission check in this
 * file because `conversations_member_all` already restricts reads and
 * writes to the caller's own workspace. An update against a conversation
 * outside it silently matches zero rows rather than needing a guard clause
 * here to reject it.
 */

// ---------------------------------------------------------------------------
// Status: assign / snooze / resolve / reopen
// ---------------------------------------------------------------------------

export async function assignConversation(
  conversationId: string,
  userId: string | null,
): Promise<ActionState> {
  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("conversations")
    .update({ assignee_id: userId })
    .eq("id", conversationId);

  if (error) return { error: error.message };
  revalidatePath("/inbox");
  return {};
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

const ContactNameSchema = z.string().trim().min(1, "Name is required.").max(120);

/**
 * Chat-widget visitors who skip or predate the pre-chat name form show up
 * as "Unknown" — this lets an agent set the name once they learn it, same
 * update path the widget itself uses (contacts.name), so it also updates
 * anywhere else the contact is referenced (conversation list, other threads).
 */
export async function updateContactName(
  contactId: string,
  name: string,
): Promise<ActionState> {
  const parsed = ContactNameSchema.safeParse(name);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid name." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("contacts")
    .update({ name: parsed.data })
    .eq("id", contactId);

  if (error) return { error: error.message };
  revalidatePath("/inbox");
  return {};
}

const StatusSchema = z.enum(["open", "resolved"]);

export async function setConversationStatus(
  conversationId: string,
  status: "open" | "resolved",
): Promise<ActionState> {
  const parsed = StatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };

  const supabase = await createServerSupabase();
  // resolved_at / snoozed_until are maintained by the
  // conversations_status_change trigger (0003) — this only sets the status
  // itself.
  const { error } = await supabase
    .from("conversations")
    .update({ status: parsed.data })
    .eq("id", conversationId);

  if (error) return { error: error.message };
  revalidatePath("/inbox");
  return {};
}

const SNOOZE_PRESETS = {
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  tomorrow: 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
} as const;

export async function snoozeConversation(
  conversationId: string,
  preset: keyof typeof SNOOZE_PRESETS,
): Promise<ActionState> {
  const ms = SNOOZE_PRESETS[preset];
  if (!ms) return { error: "Invalid snooze duration." };

  const supabase = await createServerSupabase();
  const snoozedUntil = new Date(Date.now() + ms).toISOString();

  const { error } = await supabase
    .from("conversations")
    .update({ status: "snoozed", snoozed_until: snoozedUntil })
    .eq("id", conversationId);

  if (error) return { error: error.message };
  revalidatePath("/inbox");
  return {};
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

const ReplySchema = z.object({
  text: z.string().trim().min(1, "Reply cannot be empty.").max(20000),
});

/**
 * Email reply: delegates to lib/email/send.ts, which handles threading
 * headers and records the outbound message.
 */
export async function sendEmailReplyAction(
  conversationId: string,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ReplySchema.safeParse({ text: formData.get("text") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createServerSupabase();
  const result = await sendReply(supabase, conversationId, user.id, {
    text: parsed.data.text,
    html: textToSimpleHtml(parsed.data.text),
  });

  if (!result.ok) return { error: result.error };
  revalidatePath(`/inbox/${conversationId}`);
  return {};
}

/**
 * Chat reply: no SMTP delivery — just a durable write plus a push over the
 * same broadcast channel the widget already listens to (see
 * lib/widget/realtime.ts). The write is what's authoritative; the broadcast
 * is a best-effort low-latency nudge, exactly as it is for the visitor's own
 * messages.
 */
export async function sendChatReplyAction(
  conversationId: string,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ReplySchema.safeParse({ text: formData.get("text") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in." };

  const supabase = await createServerSupabase();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("workspace_id")
    .eq("id", conversationId)
    .eq("channel", "chat")
    .maybeSingle();
  if (!conversation) return { error: "Conversation not found." };

  const { data: message, error } = await supabase
    .from("messages")
    .insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversationId,
      author_type: "agent",
      author_user_id: user.id,
      body_text: parsed.data.text,
    })
    .select("id, author_type, body_text, created_at")
    .single();

  if (error || !message) return { error: error?.message ?? "Could not send." };

  await broadcast(conversationId, {
    event: "message",
    payload: {
      id: message.id,
      conversationId,
      authorType: "agent",
      bodyText: message.body_text,
      createdAt: message.created_at,
    },
  });

  revalidatePath(`/inbox/${conversationId}`);
  return {};
}

/** Mark the visitor's messages as seen — the agent-side half of the widget's
 *  read-receipt listener, which has been waiting for this since the widget
 *  shipped. */
export async function markConversationRead(conversationId: string): Promise<void> {
  await broadcast(conversationId, {
    event: "read",
    payload: { by: "agent", at: new Date().toISOString() },
  });
}

/** Agent-side half of the typing indicator — the widget already sends its
 *  own `from: "visitor"` typing events and renders `from: "agent"` ones
 *  (src/widget/realtime.ts), but nothing on the dashboard ever broadcast
 *  the agent's side of it until now. Chat-only: an email reply has no live
 *  recipient to show a typing state to. */
export async function sendTypingSignal(conversationId: string, typing: boolean): Promise<void> {
  await broadcast(conversationId, {
    event: "typing",
    payload: { from: "agent", typing },
  });
}

function textToSimpleHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
