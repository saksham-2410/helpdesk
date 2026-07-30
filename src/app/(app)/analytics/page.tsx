import Link from "next/link";
import { PageHeader, EmptyState } from "@/components/ui/empty-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import {
  getAnalyticsOverview,
  getChannelBreakdown,
  getHourlyDistribution,
  getAgentBreakdown,
} from "@/lib/analytics/data";
import { formatDuration, formatPercent, formatHour } from "@/lib/analytics/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Analytics" };

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const days = RANGES.some((r) => String(r.days) === daysParam) ? Number(daysParam) : 30;

  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const [overview, channels, hours, agents] = await Promise.all([
    getAnalyticsOverview(supabase, workspace.id, days),
    getChannelBreakdown(supabase, workspace.id, days),
    getHourlyDistribution(supabase, workspace.id, days),
    getAgentBreakdown(supabase, workspace.id, days),
  ]);

  const rangeSelector = (
    <div className="flex gap-1">
      {RANGES.map((r) => (
        <Link
          key={r.days}
          href={`/analytics?days=${r.days}`}
          className={cn(
            "rounded-xs px-2.5 py-1 text-[0.6875rem] font-medium transition-colors",
            r.days === days
              ? "bg-accent text-accent-text"
              : "text-secondary hover:bg-surface-emphasis",
          )}
        >
          {r.label}
        </Link>
      ))}
    </div>
  );

  if (!overview || overview.total_conversations === 0) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Response times and resolution rates."
          actions={rangeSelector}
        />
        <EmptyState
          title="Not enough data yet"
          description="Once conversations start flowing, response and resolution metrics appear here."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Response times and resolution rates."
        actions={rangeSelector}
      />

      <div className="mx-auto w-full max-w-4xl space-y-8 overflow-y-auto px-6 py-8">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Conversations" value={String(overview.total_conversations)} />
          <StatCard label="Open" value={String(overview.open_count)} />
          <StatCard label="Resolved" value={String(overview.resolved_count)} />
          <StatCard label="Resolution rate" value={formatPercent(overview.resolution_rate)} />
          <StatCard label="Avg first response" value={formatDuration(overview.avg_first_response_minutes)} />
          <StatCard label="Avg resolution time" value={formatDuration(overview.avg_resolution_minutes)} />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 font-serif text-lg">By channel</h2>
            {channels.length === 0 ? (
              <p className="text-sm text-muted">No conversations in this range.</p>
            ) : (
              <div className="space-y-3">
                {channels.map((c) => (
                  <ChannelRow
                    key={c.channel}
                    channel={c.channel}
                    total={c.total}
                    resolved={c.resolved_count}
                    maxTotal={Math.max(...channels.map((x) => x.total))}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="mb-3 font-serif text-lg">Busiest hours</h2>
            <HourlyChart hours={hours} />
          </section>
        </div>

        <section className="rounded-lg border border-border-subtle bg-surface">
          <h2 className="border-b border-border-subtle px-4 py-3 font-serif text-lg">
            By agent
          </h2>
          {agents.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              No conversations assigned to an agent in this range.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="label-eyebrow border-b border-border-subtle">
                  <th className="px-4 py-2 font-medium">Agent</th>
                  <th className="px-4 py-2 font-medium">Assigned</th>
                  <th className="px-4 py-2 font-medium">Resolved</th>
                  <th className="px-4 py-2 font-medium">Resolution rate</th>
                  <th className="px-4 py-2 font-medium">Avg resolution time</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.user_id} className="border-b border-border-subtle last:border-0">
                    <td className="px-4 py-2.5">{a.email}</td>
                    <td className="px-4 py-2.5 text-machine">{a.assigned_count}</td>
                    <td className="px-4 py-2.5 text-machine">{a.resolved_count}</td>
                    <td className="px-4 py-2.5 text-machine">
                      {formatPercent(a.assigned_count > 0 ? a.resolved_count / a.assigned_count : null)}
                    </td>
                    <td className="px-4 py-2.5 text-machine">
                      {formatDuration(a.avg_resolution_minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3.5 py-3">
      <p className="label-eyebrow">{label}</p>
      <p className="mt-1 font-serif text-2xl leading-none">{value}</p>
    </div>
  );
}

function ChannelRow({
  channel,
  total,
  resolved,
  maxTotal,
}: {
  channel: string;
  total: number;
  resolved: number;
  maxTotal: number;
}) {
  const width = maxTotal > 0 ? Math.max((total / maxTotal) * 100, 4) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium capitalize">{channel}</span>
        <span className="text-machine">
          {total} total · {resolved} resolved
        </span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-surface-emphasis">
        <div
          className="h-2 rounded-full bg-accent"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function HourlyChart({ hours }: { hours: { hour_of_day: number; total: number }[] }) {
  const byHour = new Map(hours.map((h) => [h.hour_of_day, h.total]));
  const max = Math.max(1, ...hours.map((h) => h.total));
  const buckets = Array.from({ length: 24 }, (_, h) => byHour.get(h) ?? 0);

  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]">
        {buckets.map((count, hour) => (
          <div
            key={hour}
            className="group relative flex-1"
            title={`${formatHour(hour)}: ${count} conversation${count === 1 ? "" : "s"}`}
          >
            <div
              className={cn(
                "w-full rounded-t-xs transition-colors",
                count > 0 ? "bg-accent group-hover:bg-accent-hover" : "bg-surface-emphasis",
              )}
              style={{ height: `${Math.max((count / max) * 96, count > 0 ? 4 : 2)}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-machine !text-[0.5625rem]">
        <span>{formatHour(0)}</span>
        <span>{formatHour(6)}</span>
        <span>{formatHour(12)}</span>
        <span>{formatHour(18)}</span>
        <span>{formatHour(23)}</span>
      </div>
      <p className="mt-2 text-machine">UTC</p>
    </div>
  );
}
