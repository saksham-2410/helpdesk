import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listConversationsPage, listMembers, type ConversationFilters } from "@/lib/inbox/data";
import { ConversationListPane } from "./conversation-list";

/** Same default the list pane's own filter state starts at — "Open" is
 *  what an agent wants to see on every fresh inbox load. */
const DEFAULT_FILTERS: ConversationFilters = { channel: "all", status: "open", assigneeId: "all" };

/**
 * Wraps both the empty state (page.tsx) and the conversation detail route
 * ([id]/page.tsx) — the list pane is persistent chrome, not something either
 * of those routes should re-fetch or re-render independently.
 */
export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  // wake_due_snoozed_conversations (0003_functions.sql) existed but was never
  // called anywhere — a conversation snoozed with no reply from the customer
  // stayed snoozed forever, since the only other reopen path is the
  // message-insert trigger. Running it here means every inbox load self-heals
  // any snoozes that came due, with no scheduler required. Awaited before the
  // list fetch so a conversation that just woke up shows as open immediately
  // rather than one render behind.
  await supabase.rpc("wake_due_snoozed_conversations", { ws: workspace.id });

  const [conversationPage, members] = await Promise.all([
    listConversationsPage(supabase, workspace.id, DEFAULT_FILTERS),
    listMembers(supabase, workspace.id),
  ]);

  return (
    <div className="flex h-full min-h-0">
      <ConversationListPane
        workspaceId={workspace.id}
        initialConversations={conversationPage.items}
        initialCursor={conversationPage.nextCursor}
        members={members}
      />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
