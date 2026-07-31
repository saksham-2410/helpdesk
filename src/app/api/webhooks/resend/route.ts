import { Resend } from "resend";
import { createServiceSupabase } from "@/lib/supabase/service";
import { env, features } from "@/lib/env";
import {
  resolveThread,
  extractConversationToken,
  normalizeMessageId,
  parseReferences,
} from "@/lib/email/threading";
import { stripQuotedHtml, stripQuotedText, toPlainText } from "@/lib/email/quoted";
import { createDbThreadResolvers } from "@/lib/email/resolvers";
import { scheduleSummaryRefresh } from "@/lib/ai/schedule";

/**
 * Resend inbound webhook.
 *
 * The webhook payload carries METADATA ONLY — sender, recipients, subject,
 * message_id — never the body, headers, or attachments (confirmed against
 * the SDK's own response types: `ReceivedEmailEventData` has no html/text/
 * headers fields). Content is fetched separately via
 * `resend.emails.receiving.get(email_id)`, which is where the actual
 * threading headers (In-Reply-To, References) live too.
 *
 * Runs entirely on the service-role client — there is no user session for an
 * inbound email — so every write below is scoped by hand rather than by RLS.
 */

// A stored message now schedules a background summary refresh
// (lib/ai/schedule.ts) via next/server's after() — same latency profile as
// the summary/draft-reply routes, so it gets the same budget.
export const maxDuration = 30;

interface Headers {
  [key: string]: string;
}

function getHeader(headers: Headers | null, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/** "Jane Doe <jane@x.com>" -> { email: "jane@x.com", name: "Jane Doe" } */
function parseFromHeader(from: string): { email: string; name: string | null } {
  const match = from.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1]!.trim();
    return { email: match[2]!.trim().toLowerCase(), name: name.length > 0 ? name : null };
  }
  return { email: from.trim().toLowerCase(), name: null };
}

export async function POST(request: Request) {
  if (!features.email || !env.resendWebhookSecret) {
    // No secret configured yet — most likely this route was hit before the
    // webhook was registered in the Resend dashboard (that registration
    // itself needs this URL to exist first). Reject rather than process
    // unverified input.
    return new Response("Webhook not configured.", { status: 503 });
  }

  const rawBody = await request.text();
  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing signature headers.", { status: 400 });
  }

  const resend = new Resend(env.resendApiKey);

  let event: ReturnType<typeof resend.webhooks.verify>;
  try {
    // resend.webhooks.verify() both verifies (throws on a bad signature) and
    // parses the payload in one call — no separate JSON.parse needed.
    event = resend.webhooks.verify({
      payload: rawBody,
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret: env.resendWebhookSecret,
    });
  } catch {
    return new Response("Invalid signature.", { status: 401 });
  }

  if (event.type !== "email.received") {
    // This endpoint may end up subscribed to other event types later
    // (bounced, delivered) — ignore anything that isn't inbound mail rather
    // than erroring, so adding a subscription in the dashboard never breaks
    // this handler. Narrowing on `event.type` above types `event.data` as
    // ReceivedEmailEventData below — no manual cast needed.
    return Response.json({ ok: true, ignored: event.type });
  }

  const emailId = event.data.email_id;
  const inboundMessageId = normalizeMessageId(event.data.message_id);

  const db = createServiceSupabase();

  // Idempotency — Resend retries on anything but a 2xx, and the unique index
  // on messages.email_message_id makes a duplicate insert fail anyway; this
  // check just avoids doing the work (and the extra Resend API call below)
  // twice for the common case of a genuine retry.
  if (inboundMessageId) {
    const { data: existing } = await db
      .from("messages")
      .select("id")
      .eq("email_message_id", inboundMessageId)
      .maybeSingle();
    if (existing) return Response.json({ ok: true, deduped: true });
  }

  const { data: full, error: fetchError } = await resend.emails.receiving.get(emailId);
  if (fetchError || !full) {
    console.error("[webhooks/resend] failed to fetch received email", fetchError);
    // A transient Resend-side failure should be retried — 500 tells Resend
    // to try delivering this webhook again later.
    return new Response("Could not fetch email content.", { status: 500 });
  }

  const { email: fromEmail, name: fromName } = parseFromHeader(full.from);
  const headers = full.headers as Headers | null;
  const inReplyToHeader = getHeader(headers, "in-reply-to");
  const referencesHeader = getHeader(headers, "references");

  const resolvers = createDbThreadResolvers(db);
  const match = await resolveThread(
    {
      fromEmail,
      recipients: [...full.to, ...(full.cc ?? []), ...(full.bcc ?? [])],
      subject: full.subject,
      inReplyTo: inReplyToHeader,
      references: referencesHeader,
    },
    resolvers,
  );

  let workspaceId: string;
  let contactId: string;
  let conversationId: string;

  if (match.strategy !== "none") {
    const { data: conversation } = await db
      .from("conversations")
      .select("id, workspace_id, contact_id")
      .eq("id", match.conversationId)
      .maybeSingle();

    if (!conversation) {
      // Resolver found a conversation id that no longer exists — should not
      // happen outside a race with a hard delete, but fail closed rather
      // than crash.
      return Response.json({ ok: true, error: "resolved conversation vanished" });
    }
    workspaceId = conversation.workspace_id;
    contactId = conversation.contact_id;
    conversationId = conversation.id;
  } else {
    // No existing thread matched — this is either a genuinely new
    // conversation, or the first message the customer ever sent. Resolve
    // which workspace it belongs to from the plus-address tag (each
    // workspace's inbound address is support+<slug>@domain — see Settings),
    // falling back to "the only workspace on this deployment" so a bare
    // support@domain still works for a single-tenant evaluation setup.
    const tag = extractConversationToken(
      [...full.to, ...(full.cc ?? [])],
      env.supportEmail.split("@")[0],
    );

    let resolvedWorkspaceId: string | null = null;
    if (tag) {
      const { data: ws } = await db.from("workspaces").select("id").eq("slug", tag).maybeSingle();
      resolvedWorkspaceId = ws?.id ?? null;
    }
    if (!resolvedWorkspaceId) {
      const { data: allWorkspaces } = await db.from("workspaces").select("id").limit(2);
      if (allWorkspaces?.length === 1) resolvedWorkspaceId = allWorkspaces[0]!.id;
    }

    if (!resolvedWorkspaceId) {
      console.warn(
        `[webhooks/resend] could not route inbound email to any workspace (to=${full.to.join(",")})`,
      );
      // Nothing to retry into existence — accept so Resend stops retrying.
      return Response.json({ ok: true, unrouted: true });
    }
    workspaceId = resolvedWorkspaceId;

    const { data: existingContact } = await db
      .from("contacts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("email", fromEmail)
      .maybeSingle();

    if (existingContact) {
      contactId = existingContact.id;
      await db
        .from("contacts")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", contactId);
    } else {
      const { data: createdContact, error: contactError } = await db
        .from("contacts")
        .insert({
          workspace_id: workspaceId,
          email: fromEmail,
          name: fromName,
          last_seen_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (contactError || !createdContact) {
        console.error("[webhooks/resend] contact creation failed", contactError);
        return new Response("Could not create contact.", { status: 500 });
      }
      contactId = createdContact.id;
    }

    const { data: createdConversation, error: convError } = await db
      .from("conversations")
      .insert({
        workspace_id: workspaceId,
        contact_id: contactId,
        channel: "email",
        status: "open",
        subject: full.subject,
      })
      .select("id")
      .single();
    if (convError || !createdConversation) {
      console.error("[webhooks/resend] conversation creation failed", convError);
      return new Response("Could not create conversation.", { status: 500 });
    }
    conversationId = createdConversation.id;
  }

  // Quoted-history trimming happens per format using its own markers (see
  // quoted.ts) — HTML and plain text quote differently, so each is stripped
  // natively rather than converting one to the other first.
  const strippedHtml = full.html ? stripQuotedHtml(full.html) : null;
  const strippedText = full.text ? stripQuotedText(full.text) : null;
  const bodyText = strippedText ?? toPlainText({ html: strippedHtml ?? undefined });

  const { error: insertError } = await db.from("messages").insert({
    workspace_id: workspaceId,
    conversation_id: conversationId,
    author_type: "contact",
    body_html: strippedHtml,
    body_text: bodyText,
    email_message_id: normalizeMessageId(full.message_id),
    in_reply_to: normalizeMessageId(inReplyToHeader) ?? null,
    refs: parseReferences(referencesHeader),
  });

  if (insertError) {
    // A unique-violation here means a concurrent delivery of the same
    // webhook won the race — the idempotency check above is best-effort, not
    // a lock, so this is the actual guarantee. Treat it as success.
    if (insertError.code === "23505") return Response.json({ ok: true, deduped: true });
    console.error("[webhooks/resend] message insert failed", insertError);
    return new Response("Could not store message.", { status: 500 });
  }

  scheduleSummaryRefresh(db, conversationId, workspaceId);

  return Response.json({ ok: true, conversationId });
}
