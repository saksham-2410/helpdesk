import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { getConversation, listMessages } from "@/lib/inbox/data";
import { searchArticles, getArticleBodies } from "@/lib/kb/data";
import { draftReply } from "@/lib/ai/client";
import { features } from "@/lib/env";

/**
 * POST /api/conversations/[id]/draft-reply
 *
 * On-demand, not cached and not auto-triggered — the agent explicitly asks
 * for a draft, reviews it, edits it, and sends it themselves. This never
 * writes a message or touches conversation state; it only ever returns
 * text for the client to drop into the composer.
 */
// Gemini calls with a schema + system instruction on this model routinely
// take 15-25s — the platform default (10s) would kill the request before
// our own 25s AbortController ever gets a chance to fire.
export const maxDuration = 30;

export async function GET() {
  return Response.json({ error: "Use POST." }, { status: 405 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  if (!features.ai) {
    return Response.json({ error: "AI isn't configured for this workspace.", unavailable: true });
  }

  const { id } = await params;
  const supabase = await createServerSupabase();

  const conversation = await getConversation(supabase, id);
  if (!conversation) return Response.json({ error: "Not found." }, { status: 404 });

  const messages = await listMessages(supabase, id);
  if (messages.length === 0) {
    return Response.json({ error: "Nothing to reply to yet." }, { status: 400 });
  }

  // Search the KB using the customer's own words — same free-text query
  // shape the widget's own suggestion box already uses (lib/kb/data.ts's
  // searchArticles), just triggered explicitly instead of on every keystroke.
  const lastContactMessage = [...messages].reverse().find((m) => m.author_type === "contact");
  const searchQuery = (lastContactMessage ?? messages[messages.length - 1]!).body_text;
  const articles = searchQuery
    ? await searchArticles(supabase, conversation.workspace_id, searchQuery, 3)
    : [];

  // The excerpt search_kb_articles returns is a short author-written teaser
  // (fine for a "you might find this helpful" link) — too vague for the
  // model to draft concrete steps from without either guessing or refusing.
  // Pull the real body for these specific ids instead.
  const bodies = await getArticleBodies(supabase, articles.map((a) => a.id));

  try {
    const draft = await draftReply({
      // Last 12 messages: enough context for a coherent draft without
      // feeding an unbounded transcript into every single click.
      messages: messages.slice(-12).map((m) => ({
        authorType: m.author_type,
        bodyText: m.body_text,
      })),
      contactName: conversation.contact?.name ?? conversation.contact?.email ?? null,
      articles: articles.map((a) => ({
        title: a.title,
        content: (bodies[a.id] ?? a.excerpt ?? "").slice(0, 1000),
      })),
    });
    return Response.json({ draft });
  } catch (err) {
    console.error("[ai] draftReply failed", err);
    return Response.json({ error: "Could not generate a draft right now." }, { status: 500 });
  }
}
