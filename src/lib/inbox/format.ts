/** Compact relative time for a dense list ("2m", "3h", "5d") rather than
 *  date-fns's verbose "2 minutes ago" — consistent with the widget's own
 *  formatTime in src/widget/format.ts, which made the same call. */
export function compactRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));

  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d`;
  const diffWeek = Math.floor(diffDay / 7);
  if (diffWeek < 5) return `${diffWeek}w`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function contactDisplayName(
  contact: { name: string | null; email: string | null } | null,
): string {
  if (!contact) return "Unknown";
  return contact.name?.trim() || contact.email || "Unknown";
}
