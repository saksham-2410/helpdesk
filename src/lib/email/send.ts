import "server-only";
import { Resend } from "resend";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
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
  const referencesHeader = formatReferencesHeader(references);

  const resend = new Resend(env.resendApiKey);

  const { data: sent, error: sendError } = await resend.emails.send({
    from: `Support <${env.supportEmail}>`,
    to: contact.email,
    // Layer 2 of the threading strategy: even if headers get stripped by the
    // recipient's client, replying lands on this plus-address and is matched
    // back to this exact conversation on the way in.
    replyTo: replyToAddress(conversation.email_token, env.emailDomain),
    subject: replySubject(conversation.subject),
    html: body.html,
    text: body.text,
    headers: {
      ...(lastInbound?.email_message_id
        ? { "In-Reply-To": `<${lastInbound.email_message_id}>` }
        : {}),
      ...(referencesHeader ? { References: referencesHeader } : {}),
    },
  });

  if (sendError || !sent) {
    return { ok: false, error: sendError?.message ?? "Send failed." };
  }

  // The send response's `id` is Resend's own object id (a UUID) — NOT the
  // RFC 5322 Message-ID header placed on the outgoing email. Confirmed via
  // the SDK's response types: emails.get() returns a distinct `message_id`
  // field alongside `id`. Using the send response's `id` here would work for
  // exactly zero round trips — nothing would ever match it in a future
  // In-Reply-To — so the real Message-ID is fetched with one extra call
  // rather than assumed.
  const { data: full, error: getError } = await resend.emails.get(sent.id);
  if (getError || !full) {
    // The email is already sent at this point; only our own threading record
    // is incomplete. Store what we have (null email_message_id) rather than
    // reporting a send failure that didn't happen — a future reply from this
    // customer still resolves via the plus-address (layer 2) or subject
    // heuristic (layer 3) even without this message's own id.
    await supabase.from("messages").insert({
      workspace_id: conversation.workspace_id,
      conversation_id: conversationId,
      author_type: "agent",
      author_user_id: authorUserId,
      body_html: body.html,
      body_text: body.text,
      in_reply_to: lastInbound?.email_message_id ?? null,
      refs: references,
    });
    return { ok: true };
  }

  const { error: insertError } = await supabase.from("messages").insert({
    workspace_id: conversation.workspace_id,
    conversation_id: conversationId,
    author_type: "agent",
    author_user_id: authorUserId,
    body_html: body.html,
    body_text: body.text,
    email_message_id: normalizeMessageId(full.message_id),
    in_reply_to: lastInbound?.email_message_id ?? null,
    refs: references,
  });

  if (insertError) return { ok: false, error: insertError.message };
  return { ok: true };
}
