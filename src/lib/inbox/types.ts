export type ConversationStatus = "open" | "snoozed" | "resolved";
export type Channel = "chat" | "email";
export type AuthorType = "contact" | "agent" | "system";

export interface ConversationListItem {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  assignee_id: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  snoozed_until: string | null;
  contact: { id: string; name: string | null; email: string | null } | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  author_type: AuthorType;
  author_user_id: string | null;
  body_html: string | null;
  body_text: string;
  created_at: string;
}

export interface ConversationDetail {
  id: string;
  workspace_id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  assignee_id: string | null;
  snoozed_until: string | null;
  contact: { id: string; name: string | null; email: string | null; visitor_id: string | null } | null;
}

export interface WorkspaceMemberOption {
  user_id: string;
  email: string;
  role: "admin" | "agent";
}

/** conversations.* row shape as it arrives over a Realtime postgres_changes payload. */
export interface ConversationRow {
  id: string;
  workspace_id: string;
  contact_id: string;
  channel: Channel;
  status: ConversationStatus;
  subject: string | null;
  assignee_id: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  snoozed_until: string | null;
}
