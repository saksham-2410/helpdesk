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
