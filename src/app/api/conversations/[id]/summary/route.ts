import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { getConversation } from "@/lib/inbox/data";
import { getConversationSummary } from "@/lib/ai/summarize";
import { features } from "@/lib/env";

/**
 * GET /api/conversations/[id]/summary
 *
 * Authenticated (cookie session, RLS) rather than a widget-style route — only
 * agents ever see this. `getConversation` already scopes the read to the
 * caller's workspace, so a conversation outside it 404s here the same way it
 * does in the inbox UI, and there is no separate authorization check to get
 * wrong.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  if (!features.ai) {
    return Response.json({ summary: null, unavailable: true });
  }

  const { id } = await params;
  const supabase = await createServerSupabase();
  const conversation = await getConversation(supabase, id);
  if (!conversation) return Response.json({ error: "Not found." }, { status: 404 });

  const result = await getConversationSummary(
    supabase,
    id,
    conversation.workspace_id,
    conversation.contact?.name ?? conversation.contact?.email ?? null,
  );

  return Response.json({ summary: result });
}
