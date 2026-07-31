import "server-only";
import { Resend } from "resend";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { scheduleSummaryRefresh } from "@/lib/ai/schedule";
import {
  buildReferences,
  formatReferencesHeader,
  normalizeMessageId,
  replySubject,
  replyToAddress,
} from "./threading";

/**
 * Send an agent's reply as an outbound email and record it.
 *
 * Every DB read and write here goes through the CALLER'S RLS-scoped client —
 * this function is not itself the authorization boundary. If the calling
 * agent's session can't see this conversation under RLS, the initial select
 * simply returns nothing and the function fails closed; a service-role
 * client is deliberately not used, so this can't be tricked into sending as
 * or writing into a workspace the caller doesn't belong to.
 *
 * The message row is written FIRST, synchronously — the two Resend network
 * calls this used to make inline (send, then get() to fetch the real RFC
 * 5322 Message-ID; see the comment below on why a second call is
 * unavoidable) ran in the agent's own request before this change, adding
 * ~1-2s to every reply's click-to-done time for delivery mechanics that
 * don't need to block it. They now run in next/server's `after()`, updating
 * the already-written row's `email_message_id` once known. This does trade
 * away one thing: if the deferred send fails outright, the agent's UI has
 * already reported success and won't surface that. Logged (matches the
 * existing posture on broadcast() failures elsewhere in this codebase) but
 * not surfaced — a "delivery failed" indicator on a message row is a real,
 * reasonable follow-up this doesn't build.
 */

export interface SendReplyResult {
  ok: boolean;
  error?: string;
}

export async function sendReply(
  supabase: SupabaseClient,
  conversationId: string,
  authorUserId: string,
  body: { html: string; text: string },
): Promise<SendReplyResult> {
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, workspace_id, contact_id, subject, email_token, contact:contacts(email)")
    .eq("id", conversationId)
    .eq("channel", "email")
    .maybeSingle();

  if (!conversation) return { ok: false, error: "Conversation not found." };

  // PostgREST types an embedded to-one relation as possibly-array.
  const contact = Array.isArray(conversation.contact)
    ? conversation.contact[0]
    : conversation.contact;
  if (!contact?.email) return { ok: false, error: "This contact has no email address." };

  const { data: lastInbound } = await supabase
    .from("messages")
    .select("email_message_id, refs")
    .eq("conversation_id", conversationId)
    .eq("author_type", "contact")
    .not("email_message_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const references = buildReferences(
    lastInbound?.refs ?? null,
    lastInbound?.email_message_id ?? null,
  );

  const { data: message, error: insertError } = await supabase
    .from("messages")
    .insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversationId,
      author_type: "agent",
      author_user_id: authorUserId,
      body_html: body.html,
      body_text: body.text,
      in_reply_to: lastInbound?.email_message_id ?? null,
      refs: references,
    })
    .select("id")
    .single();

  if (insertError || !message) return { ok: false, error: insertError?.message ?? "Could not send." };

  scheduleSummaryRefresh(supabase, conversationId, conversation.workspace_id);

  const referencesHeader = formatReferencesHeader(references);
  const recipient = contact.email;
  const replyTo = replyToAddress(conversation.email_token, env.emailDomain);
  const subject = replySubject(conversation.subject);
  const inReplyToHeader = lastInbound?.email_message_id
    ? `<${lastInbound.email_message_id}>`
    : undefined;

  after(async () => {
    try {
      const resend = new Resend(env.resendApiKey);

      const { data: sent, error: sendError } = await resend.emails.send({
        from: `Support <${env.supportEmail}>`,
        to: recipient,
        // Layer 2 of the threading strategy: even if headers get stripped
        // by the recipient's client, replying lands on this plus-address
        // and is matched back to this exact conversation on the way in.
        replyTo,
        subject,
        html: body.html,
        text: body.text,
        headers: {
          ...(inReplyToHeader ? { "In-Reply-To": inReplyToHeader } : {}),
          ...(referencesHeader ? { References: referencesHeader } : {}),
        },
      });

      if (sendError || !sent) {
        console.error("[email] deferred send failed", sendError);
        return;
      }

      // The send response's `id` is Resend's own object id (a UUID) — NOT
      // the RFC 5322 Message-ID header placed on the outgoing email.
      // Confirmed via the SDK's response types: emails.get() returns a
      // distinct `message_id` field alongside `id`. Using the send
      // response's `id` here would work for exactly zero round trips —
      // nothing would ever match it in a future In-Reply-To — so the real
      // Message-ID is fetched with one extra call rather than assumed.
      const { data: full, error: getError } = await resend.emails.get(sent.id);
      if (getError || !full) {
        // The email is already sent at this point; only our own threading
        // record is incomplete. A future reply from this customer still
        // resolves via the plus-address (layer 2) or subject heuristic
        // (layer 3) even without this message's own id, so leaving
        // email_message_id null here is a degraded-but-fine outcome, not
        // an error to report.
        console.error("[email] fetching sent message_id failed", getError);
        return;
      }

      const { error: updateError } = await supabase
        .from("messages")
        .update({ email_message_id: normalizeMessageId(full.message_id) })
        .eq("id", message.id);
      if (updateError) console.error("[email] recording message_id failed", updateError);
    } catch (err) {
      console.error("[email] deferred send threw", err);
    }
  });

  return { ok: true };
}
