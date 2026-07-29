/**
 * Pure helpers for the widget's message list — kept dependency-free (no DOM,
 * no Supabase client) so the merge logic that actually matters for
 * correctness — reconciling optimistic sends, broadcast pushes, and backfill
 * results into one ordered, de-duplicated list — is unit-testable without a
 * browser.
 */

export interface WidgetMessage {
  id: string;
  authorType: "contact" | "agent" | "system";
  bodyText: string;
  createdAt: string;
  /** Locally-generated id for a message not yet confirmed by the server. */
  pending?: boolean;
}

/**
 * Merge new messages into an existing list: de-duplicate by id, sort by
 * timestamp, and let a server-confirmed message replace its optimistic
 * placeholder.
 *
 * Three sources feed this over a widget's lifetime — the initial session
 * history, realtime broadcast pushes, and reconnect backfill — and any of
 * them can overlap with what's already rendered. Correctness here is what
 * "message ordering guarantee" actually means in practice: not that events
 * arrive in order (they don't, over an unreliable connection), but that the
 * rendered list always converges to the same order regardless of arrival
 * order.
 */
export function mergeMessages(
  existing: WidgetMessage[],
  incoming: WidgetMessage[],
): WidgetMessage[] {
  const byId = new Map<string, WidgetMessage>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);

  return [...byId.values()].sort((a, b) => {
    const t = Date.parse(a.createdAt) - Date.parse(b.createdAt);
    // Stable tiebreak for same-millisecond messages (rare but not impossible
    // under Postgres timestamp precision vs. real-world send bursts) — sort
    // by id so re-merging the same set never reorders it.
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/**
 * Replace an optimistic placeholder with its server-confirmed counterpart.
 * If the placeholder is missing (e.g. arrived via broadcast before the POST
 * response did), the confirmed message is simply added.
 */
export function reconcileOptimistic(
  existing: WidgetMessage[],
  optimisticId: string,
  confirmed: WidgetMessage,
): WidgetMessage[] {
  const withoutPlaceholder = existing.filter((m) => m.id !== optimisticId);
  return mergeMessages(withoutPlaceholder, [confirmed]);
}

/** The most recent message's timestamp, for backfill's `after` cursor. */
export function latestTimestamp(messages: WidgetMessage[]): string | null {
  if (messages.length === 0) return null;
  return messages.reduce((latest, m) => (m.createdAt > latest ? m.createdAt : latest), messages[0]!.createdAt);
}

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : TIME_FORMATTER.format(d);
}

/** Escape text for injection into innerHTML — the widget renders as HTML
 *  fragments (needed for the typing indicator/status markup), so any
 *  user-authored text (message bodies, names) must be escaped by hand since
 *  there is no framework doing it automatically. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
