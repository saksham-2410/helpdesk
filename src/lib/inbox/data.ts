import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ConversationListItem,
  ConversationDetail,
  Message,
  WorkspaceMemberOption,
} from "./types";

/**
 * Every function here takes the caller's RLS-scoped client — there is no
 * service-role path in the inbox. An agent can only ever see conversations
 * RLS already says belong to their workspace, which is the actual tenant
 * isolation guarantee, not a workspace_id filter this code has to remember
 * to apply correctly every time.
 */

const LIST_LIMIT = 150;

export async function listConversations(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<ConversationListItem[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, channel, status, subject, assignee_id, last_message_at, last_message_preview, snoozed_until, contact:contacts(id, name, email)",
    )
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false })
    .limit(LIST_LIMIT);

  if (error) {
    console.error("[inbox] listConversations failed", error);
    return [];
  }

  // PostgREST types an embedded to-one relation as possibly-array.
  return (data ?? []).map((row) => ({
    ...row,
    contact: Array.isArray(row.contact) ? (row.contact[0] ?? null) : row.contact,
  })) as ConversationListItem[];
}

export async function getConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationDetail | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select(
      "id, workspace_id, channel, status, subject, assignee_id, snoozed_until, contact:contacts(id, name, email, visitor_id)",
    )
    .eq("id", conversationId)
    .maybeSingle();

  if (error || !data) return null;

  const contact = Array.isArray(data.contact) ? (data.contact[0] ?? null) : data.contact;
  return { ...data, contact } as ConversationDetail;
}

/**
 * Full, unpaginated history. Kept as-is deliberately — lib/ai/summarize.ts
 * relies on seeing every message to correctly compute "everything since
 * up_to_message_id", and slicing that against only a recent page would
 * silently corrupt the incremental-summary logic on any conversation longer
 * than one page. listRecentMessages() below is the paginated one, purpose
 * -built for rendering the thread instead.
 */
export async function listMessages(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, author_type, author_user_id, body_html, body_text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[inbox] listMessages failed", error);
    return [];
  }
  return data ?? [];
}

const MESSAGE_PAGE_SIZE = 50;

export interface MessagePage {
  messages: Message[];
  hasMore: boolean;
}

/**
 * Paginated thread history for the inbox UI. Loads the most recent page by
 * default; pass `before` (a message's created_at) to walk further back.
 * Composite (created_at, id) keyset rather than a plain created_at cursor —
 * two messages landing in the same instant (concurrent writes, or a batch
 * import later) would otherwise skip or duplicate across pages.
 */
export async function listRecentMessages(
  supabase: SupabaseClient,
  conversationId: string,
  options?: { before?: { createdAt: string; id: string }; limit?: number },
): Promise<MessagePage> {
  const limit = options?.limit ?? MESSAGE_PAGE_SIZE;

  let query = supabase
    .from("messages")
    .select("id, conversation_id, author_type, author_user_id, body_html, body_text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row is the cheapest way to know whether an earlier page
    // exists without a separate count query.
    .limit(limit + 1);

  if (options?.before) {
    const { createdAt, id } = options.before;
    query = query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[inbox] listRecentMessages failed", error);
    return { messages: [], hasMore: false };
  }

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  // Fetched newest-first for the LIMIT/cursor semantics above; the thread
  // itself renders oldest-first.
  return { messages: page.reverse(), hasMore };
}

export async function listMembers(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<WorkspaceMemberOption[]> {
  const { data, error } = await supabase.rpc("list_workspace_members", { ws: workspaceId });
  if (error) {
    console.error("[inbox] listMembers failed", error);
    return [];
  }
  return (data ?? []) as WorkspaceMemberOption[];
}
