"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { compactRelativeTime } from "@/lib/inbox/format";
import type { ConversationSummary, Sentiment } from "@/lib/ai/types";

interface SummaryState {
  status: "loading" | "ready" | "unavailable" | "error";
  summary?: ConversationSummary;
  generatedAt?: string;
  stale?: boolean;
}

const SENTIMENT_TONE: Record<Sentiment, "success" | "neutral" | "warning" | "danger"> = {
  positive: "success",
  neutral: "neutral",
  negative: "warning",
  frustrated: "danger",
};

/**
 * Hidden entirely below MIN_MESSAGES (kept in sync with lib/ai/summarize.ts
 * by trusting the server's response rather than duplicating the threshold
 * here) and when GEMINI_API_KEY isn't configured — an inbox with no AI key
 * should look like an inbox with no AI feature, not a broken one.
 */
export function SummaryPanel({
  conversationId,
  messageCount,
}: {
  conversationId: string;
  messageCount: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [state, setState] = useState<SummaryState>({ status: "loading" });
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (messageCount < 6) return;

    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setState((prev) => ({ ...prev, status: "loading" }));
      try {
        const res = await fetch(`/api/conversations/${conversationId}/summary`);
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (data.unavailable) {
          setState({ status: "unavailable" });
        } else if (data.summary) {
          setState({
            status: "ready",
            summary: data.summary.summary,
            generatedAt: data.summary.generatedAt,
            stale: data.summary.stale,
          });
        } else {
          setState({ status: "unavailable" });
        }
      } catch {
        setState((prev) =>
          prev.status === "ready" ? { ...prev, stale: true } : { status: "error" },
        );
      }
    }, 1200);

    return () => clearTimeout(debounce.current);
  }, [conversationId, messageCount]);

  if (messageCount < 6 || state.status === "unavailable") return null;

  return (
    <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-border-subtle bg-surface">
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-[0.8125rem] font-medium">
          <SparkleIcon />
          AI summary
          {state.status === "loading" && <span className="text-machine">Generating…</span>}
          {state.stale && state.status === "ready" && (
            <Badge tone="warning">Stale — retry failed</Badge>
          )}
        </span>
        <span className="text-machine">{collapsed ? "Show" : "Hide"}</span>
      </button>

      {!collapsed && (
        <div className="border-t border-border-subtle px-4 py-3.5">
          {state.status === "error" && (
            <p className="text-xs text-secondary">
              Couldn&apos;t generate a summary right now. The inbox still works fine without it.
            </p>
          )}
          {state.status === "loading" && !state.summary && (
            <div className="space-y-2">
              <div className="h-3 w-3/4 animate-pulse rounded bg-surface-emphasis" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-surface-emphasis" />
            </div>
          )}
          {state.summary && (
            <dl className="space-y-2.5 text-[0.8125rem] leading-relaxed">
              <Row label="Wants" value={state.summary.what_user_wants} />
              <Row label="Tried so far" value={state.summary.whats_been_tried} />
              <Row label="Status" value={state.summary.current_status} />
              <Row label="Suggested next step" value={state.summary.suggested_next_step} />
              <div className="flex items-center gap-2 pt-1">
                <dt className="label-eyebrow">Sentiment</dt>
                <Badge tone={SENTIMENT_TONE[state.summary.sentiment]}>{state.summary.sentiment}</Badge>
                {state.generatedAt && (
                  <span className="ml-auto text-machine">
                    {compactRelativeTime(state.generatedAt)}
                  </span>
                )}
              </div>
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label-eyebrow">{label}</dt>
      <dd className="mt-0.5 text-secondary">{value}</dd>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5 text-accent" aria-hidden>
      <path
        d="M8 2.5c.3 1.7 1 2.9 2.1 3.6.9.6 2 .9 3.4 1-1.4.1-2.5.4-3.4 1C9 8.8 8.3 10 8 11.7c-.3-1.7-1-2.9-2.1-3.6-.9-.6-2-.9-3.4-1 1.4-.1 2.5-.4 3.4-1C6.9 5.4 7.6 4.2 8 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
