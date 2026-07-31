"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/cn";
import { Avatar, ChannelBadge, StatusPill } from "@/components/ui/badge";
import { compactRelativeTime, contactDisplayName } from "@/lib/inbox/format";
import { loadConversationsPage } from "./actions";
import type { ConversationFilters, ConversationCursor } from "@/lib/inbox/data";
import type {
  ConversationListItem,
  ConversationRow,
  WorkspaceMemberOption,
} from "@/lib/inbox/types";

const DEFAULT_FILTERS: ConversationFilters = { channel: "all", status: "open", assigneeId: "all" };

function rowMatchesFilters(row: ConversationRow, filters: ConversationFilters): boolean {
  if (filters.channel !== "all" && row.channel !== filters.channel) return false;
  if (filters.status !== "all" && row.status !== filters.status) return false;
  if (filters.assigneeId === "unassigned" && row.assignee_id) return false;
  if (
    filters.assigneeId !== "all" &&
    filters.assigneeId !== "unassigned" &&
    row.assignee_id !== filters.assigneeId
  )
    return false;
  return true;
}

/**
 * Live-updating conversation list. Filtering and pagination are both
 * server-side now — the previous version fetched a flat top-150 and
 * filtered a plain array in the browser, which quietly went wrong (not
 * errored) once a workspace passed 150 conversations: a filter tab could
 * only ever show what was in that top-150-by-recency slice, no matter how
 * many actually matched.
 *
 * Realtime still runs over postgres_changes on `conversations`, RLS-scoped
 * to this workspace — the agent-side counterpart to the widget's manual
 * broadcast channel, which exists specifically because an anonymous
 * visitor has no RLS-visible session to subscribe under. An incoming
 * change is checked against the CURRENT filters (via filtersRef, so the one
 * subscription set up on mount never goes stale) before merging: something
 * that no longer matches (e.g. just got resolved while viewing "Open") is
 * removed rather than left sitting in a filtered view it shouldn't be in.
 */
export function ConversationListPane({
  workspaceId,
  initialConversations,
  initialCursor,
  members,
}: {
  workspaceId: string;
  initialConversations: ConversationListItem[];
  initialCursor: ConversationCursor | null;
  members: WorkspaceMemberOption[];
}) {
  const [conversations, setConversations] = useState(initialConversations);
  const [cursor, setCursor] = useState(initialCursor);
  const [filters, setFilters] = useState<ConversationFilters>(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pathname = usePathname();
  const selectedId = pathname.match(/\/inbox\/([^/]+)/)?.[1];

  const filtersRef = useRef(filters);
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMemberOption>();
    for (const m of members) map.set(m.user_id, m);
    return map;
  }, [members]);

  // The very first render already has server-fetched data matching
  // DEFAULT_FILTERS — only refetch on filter changes that happen *after*
  // mount, not for the initial value matching its own default.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    setLoading(true);
    loadConversationsPage(workspaceId, filters, null).then((page) => {
      setConversations(page.items);
      setCursor(page.nextCursor);
      setLoading(false);
    });
  }, [workspaceId, filters]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    const page = await loadConversationsPage(workspaceId, filters, cursor);
    setConversations((prev) => [...prev, ...page.items]);
    setCursor(page.nextCursor);
    setLoadingMore(false);
  }

  useEffect(() => {
    const supabase = createBrowserSupabase();
    // Private + broadcast (0009_broadcast_inbox.sql), not postgres_changes —
    // a workspace-wide subscription over postgres_changes re-evaluates RLS
    // once per subscriber per row change, which is O(agents x message rate)
    // and the first thing to fall over in a busy shared inbox. The trigger
    // in that migration broadcasts once per write instead; `private: true`
    // is what makes the RLS policy on realtime.messages actually apply
    // (Realtime Authorization) — the same authenticated session already
    // used for every other RLS-scoped query on this page authorizes the
    // channel automatically, no extra auth wiring needed here.
    const channel = supabase
      .channel(`inbox:${workspaceId}`, { config: { private: true } })
      .on(
        "broadcast",
        { event: "*" },
        (message: {
          payload: {
            operation: "INSERT" | "UPDATE" | "DELETE";
            record: ConversationRow | null;
            old_record: ConversationRow | null;
          };
        }) => {
          const { operation, record, old_record } = message.payload;
          const row = record ?? old_record;
          if (!row) return;

          setConversations((prev) => {
            const existing = prev.find((c) => c.id === row.id);

            if (operation === "DELETE" || !rowMatchesFilters(row, filtersRef.current)) {
              return existing ? prev.filter((c) => c.id !== row.id) : prev;
            }

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
    // filtersRef, not filters, is what the handler reads — resubscribing on
    // every filter change would be needless churn for no benefit.
  }, [workspaceId]);

  return (
    <aside className="flex w-[320px] shrink-0 flex-col border-r border-border-subtle bg-surface">
      <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
        <h1 className="text-base">Inbox</h1>
        <span className="text-machine">{conversations.length}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border-subtle px-3 py-2.5">
        <FilterPill
          active={filters.status === "open"}
          onClick={() => setFilters((f) => ({ ...f, status: "open" }))}
        >
          Open
        </FilterPill>
        <FilterPill
          active={filters.status === "snoozed"}
          onClick={() => setFilters((f) => ({ ...f, status: "snoozed" }))}
        >
          Snoozed
        </FilterPill>
        <FilterPill
          active={filters.status === "resolved"}
          onClick={() => setFilters((f) => ({ ...f, status: "resolved" }))}
        >
          Resolved
        </FilterPill>
        <FilterPill
          active={filters.status === "all"}
          onClick={() => setFilters((f) => ({ ...f, status: "all" }))}
        >
          All
        </FilterPill>

        <span className="mx-0.5 self-center text-border-strong">&middot;</span>

        <FilterPill
          active={filters.channel === "all"}
          onClick={() => setFilters((f) => ({ ...f, channel: "all" }))}
        >
          Every channel
        </FilterPill>
        <FilterPill
          active={filters.channel === "chat"}
          onClick={() => setFilters((f) => ({ ...f, channel: "chat" }))}
        >
          Chat
        </FilterPill>
        <FilterPill
          active={filters.channel === "email"}
          onClick={() => setFilters((f) => ({ ...f, channel: "email" }))}
        >
          Email
        </FilterPill>

        <select
          aria-label="Filter by assignee"
          value={filters.assigneeId}
          onChange={(e) => setFilters((f) => ({ ...f, assigneeId: e.target.value }))}
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

      <div className={cn("flex-1 overflow-y-auto", loading && "opacity-50")}>
        {conversations.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">
            {loading ? "Loading…" : "No conversations here."}
          </p>
        ) : (
          <>
            {conversations.map((c, i) => {
              const assignee = c.assignee_id ? membersById.get(c.assignee_id) : undefined;
              return (
                <Link
                  key={c.id}
                  href={`/inbox/${c.id}`}
                  style={{ "--i": i } as React.CSSProperties}
                  className={cn(
                    "animate-rise flex gap-2.5 border-b border-border-subtle px-3.5 py-3 transition-colors hover:bg-surface-emphasis",
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
            })}
            {cursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 text-center text-xs font-medium text-secondary transition-colors hover:bg-surface-emphasis disabled:opacity-50"
              >
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            )}
          </>
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
        active ? "bg-accent text-accent-text" : "text-secondary hover:bg-surface-emphasis",
      )}
    >
      {children}
    </button>
  );
}
