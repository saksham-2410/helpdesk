"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { Avatar, ChannelBadge, StatusPill } from "@/components/ui/badge";
import { compactRelativeTime, contactDisplayName } from "@/lib/inbox/format";
import type {
  ConversationListItem,
  ConversationRow,
  WorkspaceMemberOption,
  Channel,
  ConversationStatus,
} from "@/lib/inbox/types";

type ChannelFilter = Channel | "all";
type StatusFilter = ConversationStatus | "all";

/**
 * Live-updating conversation list. Subscribes to postgres_changes on
 * `conversations`, scoped by RLS to this workspace — the agent-side
 * counterpart to the widget's manual broadcast channel. An authenticated
 * session can rely on RLS directly; broadcast only exists because the
 * widget's visitor cannot.
 *
 * Filtering happens client-side against the already-fetched list rather
 * than round-tripping to the server per filter change — the dataset size an
 * inbox like this deals with makes that the right trade-off, and it's
 * instant.
 */
export function ConversationListPane({
  workspaceId,
  initialConversations,
  members,
}: {
  workspaceId: string;
  initialConversations: ConversationListItem[];
  members: WorkspaceMemberOption[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const pathname = usePathname();
  const selectedId = pathname.match(/\/inbox\/([^/]+)/)?.[1];

  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMemberOption>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`inbox:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversations",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload: { new?: ConversationRow }) => {
          const row = payload.new;
          if (!row) return;

          setConversations((prev) => {
            const existing = prev.find((c) => c.id === row.id);
            const merged: ConversationListItem = {
              id: row.id,
              channel: row.channel,
              status: row.status,
              subject: row.subject,
              assignee_id: row.assignee_id,
              last_message_at: row.last_message_at,
              last_message_preview: row.last_message_preview,
              snoozed_until: row.snoozed_until,
              // The realtime payload doesn't carry the joined contact — keep
              // whatever we already had for it (set on first fetch, or on
              // this row's next full reload) rather than losing it.
              contact: existing?.contact ?? null,
            };
            const without = prev.filter((c) => c.id !== row.id);
            return [merged, ...without].sort(
              (a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at),
            );
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  const filtered = conversations.filter((c) => {
    if (channelFilter !== "all" && c.channel !== channelFilter) return false;
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (assigneeFilter === "unassigned" && c.assignee_id) return false;
    if (assigneeFilter !== "all" && assigneeFilter !== "unassigned" && c.assignee_id !== assigneeFilter)
      return false;
    return true;
  });

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-border-subtle bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h1 className="text-base">Inbox</h1>
        <span className="text-machine">{filtered.length}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-3 py-2.5">
        <FilterPill active={statusFilter === "open"} onClick={() => setStatusFilter("open")}>
          Open
        </FilterPill>
        <FilterPill active={statusFilter === "snoozed"} onClick={() => setStatusFilter("snoozed")}>
          Snoozed
        </FilterPill>
        <FilterPill active={statusFilter === "resolved"} onClick={() => setStatusFilter("resolved")}>
          Resolved
        </FilterPill>
        <FilterPill active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>
          All
        </FilterPill>

        <span className="mx-0.5 self-center text-border-strong">&middot;</span>

        <FilterPill active={channelFilter === "all"} onClick={() => setChannelFilter("all")}>
          Every channel
        </FilterPill>
        <FilterPill active={channelFilter === "chat"} onClick={() => setChannelFilter("chat")}>
          Chat
        </FilterPill>
        <FilterPill active={channelFilter === "email"} onClick={() => setChannelFilter("email")}>
          Email
        </FilterPill>

        <select
          aria-label="Filter by assignee"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="ml-auto h-6 rounded-xs border border-border-default bg-canvas px-1.5 text-[0.6875rem]"
        >
          <option value="all">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.email}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No conversations here.</p>
        ) : (
          filtered.map((c, i) => {
            const assignee = c.assignee_id ? membersById.get(c.assignee_id) : undefined;
            return (
              <Link
                key={c.id}
                href={`/inbox/${c.id}`}
                style={{ "--i": i } as React.CSSProperties}
                className={cn(
                  "animate-rise flex gap-2.5 border-b border-border-subtle px-3.5 py-3 transition-colors hover:bg-paper-100 dark:hover:bg-paper-800",
                  selectedId === c.id && "bg-accent-soft hover:bg-accent-soft",
                )}
              >
                <Avatar name={c.contact?.name} email={c.contact?.email} size="sm" className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <ChannelBadge channel={c.channel} />
                    <p className="truncate text-[0.8125rem] font-medium">
                      {contactDisplayName(c.contact)}
                    </p>
                    <span className="ml-auto shrink-0 text-machine !text-[0.625rem]">
                      {compactRelativeTime(c.last_message_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-secondary">
                    {c.last_message_preview || c.subject || "No messages yet"}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <StatusPill status={c.status} />
                    {assignee && <Avatar email={assignee.email} size="xs" />}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xs px-2 py-0.5 text-[0.6875rem] font-medium transition-colors",
        active ? "bg-accent text-accent-text" : "text-secondary hover:bg-paper-200 dark:hover:bg-paper-800",
      )}
    >
      {children}
    </button>
  );
}
