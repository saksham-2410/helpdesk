import { notFound } from "next/navigation";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getConversation, listRecentMessages, listMembers } from "@/lib/inbox/data";
import { listCannedResponses } from "@/lib/canned/data";
import { features } from "@/lib/env";
import { ConversationThread } from "./conversation-thread";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const user = await getCurrentUser();
  const supabase = await createServerSupabase();

  // getConversation is RLS-scoped, so a conversation outside this workspace
  // (or one that doesn't exist) simply returns null here — no separate
  // workspace_id check needed, and nothing distinguishes "not found" from
  // "not yours" to the client, which is the correct behavior either way.
  //
  // Only the most recent page of messages loads here — a years-old support
  // thread with thousands of messages must not ship its entire history on
  // every open. ConversationThread fetches earlier pages on demand.
  const [conversation, messagePage, members, cannedResponses] = await Promise.all([
    getConversation(supabase, id),
    listRecentMessages(supabase, id),
    listMembers(supabase, workspace.id),
    listCannedResponses(supabase, workspace.id),
  ]);

  if (!conversation) notFound();

  return (
    <ConversationThread
      conversation={conversation}
      initialMessages={messagePage.messages}
      initialHasMoreHistory={messagePage.hasMore}
      members={members}
      currentUserId={user!.id}
      cannedResponses={cannedResponses}
      aiEnabled={features.ai}
    />
  );
}
