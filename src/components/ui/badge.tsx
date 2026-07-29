import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "accent" | "signal" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  // Every tone here is a semantic token (bg-*-soft / text-*-text), never a
  // literal dark:bg-* override: this app's dark mode is driven by @media
  // (prefers-color-scheme: dark) rewriting the semantic custom properties
  // directly — there is no .dark CLASS toggle, so Tailwind's class-gated
  // `dark:` variant never actually applies here. A literal dark:bg-paper-700
  // silently does nothing. See the "Semantic layer" comment in globals.css.
  neutral: "bg-surface-emphasis text-primary",
  accent: "bg-accent-soft text-accent",
  signal: "bg-signal-soft text-signal-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type ConversationStatus = "open" | "snoozed" | "resolved";

const STATUS: Record<ConversationStatus, { tone: Tone; label: string; dot: string }> = {
  open: { tone: "signal", label: "Open", dot: "bg-signal-500" },
  snoozed: { tone: "warning", label: "Snoozed", dot: "bg-warning-500" },
  resolved: { tone: "success", label: "Resolved", dot: "bg-success-500" },
};

/**
 * Status is the single most-scanned attribute in the inbox, so it gets a dot
 * as well as a colour — colour alone fails for colour-blind operators.
 */
export function StatusPill({
  status,
  className,
}: {
  status: ConversationStatus;
  className?: string;
}) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} className={className}>
      <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </Badge>
  );
}

export type Channel = "chat" | "email";

/**
 * Channel is shown as an icon rather than a coloured pill: the unified inbox
 * mixes both constantly, and two more colours in every row would drown out
 * the status signal.
 */
export function ChannelBadge({ channel, className }: { channel: Channel; className?: string }) {
  return (
    <span
      title={channel === "chat" ? "Live chat" : "Email"}
      aria-label={channel === "chat" ? "Live chat" : "Email"}
      className={cn("inline-flex size-4 shrink-0 items-center justify-center text-muted", className)}
    >
      {channel === "chat" ? (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
          <path
            d="M3 5.5A2.5 2.5 0 0 1 5.5 3h5A2.5 2.5 0 0 1 13 5.5v3a2.5 2.5 0 0 1-2.5 2.5H7l-3 2.5V11h-.5A.5.5 0 0 1 3 10.5v-5Z"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
          <rect x="2.5" y="4" width="11" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.25" />
          <path d="m3 5 5 3.5L13 5" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/* Deterministic avatar tint — the same person is always the same colour,
   which makes an assignee column scannable without reading the names. */
const TINTS = [
  "bg-petrol-100 text-petrol-700",
  "bg-signal-100 text-signal-700",
  "bg-success-100 text-success-700",
  "bg-warning-100 text-warning-700",
  "bg-paper-300 text-paper-800",
];

export function Avatar({
  name,
  email,
  size = "md",
  className,
}: {
  name?: string | null;
  email?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const label = (name || email || "?").trim();
  const initials = label
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) | 0;
  const tint = TINTS[Math.abs(hash) % TINTS.length];

  const sizes = {
    xs: "size-5 text-[0.5625rem]",
    sm: "size-6 text-[0.625rem]",
    md: "size-8 text-[0.6875rem]",
    lg: "size-10 text-xs",
  };

  return (
    <span
      title={label}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase tracking-tight",
        sizes[size],
        tint,
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}
