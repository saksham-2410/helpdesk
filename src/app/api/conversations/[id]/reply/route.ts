import { z } from "zod";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { sendReply } from "@/lib/email/send";

/**
 * POST /api/conversations/:id/reply — an agent replying to an email
 * conversation.
 *
 * Authorization is entirely RLS: `createServerSupabase()` carries the
 * caller's session, and `sendReply` uses that same client for every read and
 * write, so a conversation outside the agent's workspace is invisible to it
 * rather than something this route has to separately check for.
 *
 * A plain, reusable endpoint rather than a page-local Server Action — this
 * existed before the inbox UI did, as the only way to verify the full email
 * round trip (receive -> reply -> threaded second reply) end to end, and the
 * inbox can call it the same way once built.
 */

const ReplySchema = z.object({
  text: z.string().trim().min(1, "Reply cannot be empty.").max(20000),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;

  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const json = await request.json().catch(() => null);
  const parsed = ReplySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid reply." },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabase();

  const result = await sendReply(supabase, conversationId, user.id, {
    text: parsed.data.text,
    html: textToSimpleHtml(parsed.data.text),
  });

  if (!result.ok) {
    return Response.json({ error: result.error ?? "Could not send reply." }, { status: 500 });
  }

  return Response.json({ ok: true });
}

/**
 * Minimal text->HTML: escape, then turn blank-line-separated blocks into
 * paragraphs and single newlines into <br>. The inbox composer (task 7) will
 * likely be rich text and pass real HTML directly; this exists so the reply
 * endpoint works correctly today, from a plain-text body, without waiting on
 * that UI.
 */
function textToSimpleHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
