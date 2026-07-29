import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listConversations, listMembers } from "@/lib/inbox/data";
import { ConversationListPane } from "./conversation-list";

/**
 * Wraps both the empty state (page.tsx) and the conversation detail route
 * ([id]/page.tsx) — the list pane is persistent chrome, not something either
 * of those routes should re-fetch or re-render independently.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const [conversations, members] = await Promise.all([
    listConversations(supabase, workspace.id),
    listMembers(supabase, workspace.id),
  ]);

  return (
    <div className="flex h-full min-h-0">
      <ConversationListPane
        workspaceId={workspace.id}
        initialConversations={conversations}
        members={members}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
