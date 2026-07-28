/**
 * Email threading.
 *
 * Header-based threading (RFC 5322 In-Reply-To / References) is the correct
 * mechanism and the one every guide describes. It is also, on its own, not
 * good enough: Outlook rewrites Message-IDs on some server configurations,
 * several webmail clients drop References on "reply from a forwarded copy",
 * and a customer who starts a fresh compose to the same address has no
 * threading headers at all.
 *
 * So resolution runs in three layers, most to least reliable:
 *
 *   1. HEADERS      — In-Reply-To / References matched against Message-IDs we
 *                     have already stored, inbound or outbound.
 *   2. PLUS ADDRESS — every outbound reply sets
 *                     Reply-To: support+<token>@domain. Mail clients preserve
 *                     the address they are replying to even when they mangle
 *                     headers, so this survives most of what layer 1 does not.
 *   3. SUBJECT      — same normalised subject from the same sender inside a
 *                     time window. A heuristic, deliberately last, and
 *                     deliberately narrow.
 *
 * Every function here is pure so the whole strategy is unit-testable without a
 * database or a mail server.
 */

/** Strip the angle brackets and whitespace around a Message-ID. */
export function normalizeMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^<|>$/g, "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parse a References or In-Reply-To header into ordered Message-IDs.
 * Both are space-separated lists of angle-bracketed ids; In-Reply-To normally
 * holds one but is permitted to hold several.
 */
export function parseReferences(header: string | null | undefined): string[] {
  if (!header) return [];
  const ids = header.match(/<[^<>\s]+>/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const norm = normalizeMessageId(id);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Candidate ancestor ids for an inbound email, most specific first.
 * In-Reply-To names the direct parent, so it is tried before the References
 * chain; the chain is walked newest-to-oldest since the nearest ancestor we
 * still know about is the best conversation match.
 */
export function threadCandidates(headers: {
  inReplyTo?: string | null;
  references?: string | null;
}): string[] {
  const direct = parseReferences(headers.inReplyTo);
  const chain = parseReferences(headers.references).reverse();

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...direct, ...chain]) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Build the References header for an outgoing reply: the parent's chain plus
 * the parent itself, per RFC 5322 §3.6.4. Capped because some servers reject
 * very long headers, keeping the oldest (thread root) and the most recent —
 * the two that actually drive client-side grouping.
 */
export function buildReferences(
  parentReferences: string[] | null | undefined,
  parentMessageId: string | null | undefined,
  max = 20,
): string[] {
  const chain = [...(parentReferences ?? [])];
  const parent = normalizeMessageId(parentMessageId);
  if (parent && !chain.includes(parent)) chain.push(parent);

  if (chain.length <= max) return chain;
  return [chain[0]!, ...chain.slice(chain.length - (max - 1))];
}

/** Render Message-IDs as a header value: each wrapped in angle brackets. */
export function formatReferencesHeader(ids: string[]): string | undefined {
  if (ids.length === 0) return undefined;
  return ids.map((id) => `<${id}>`).join(" ");
}

// ---------------------------------------------------------------------------
// Layer 2 — plus addressing
// ---------------------------------------------------------------------------

/**
 * support+<token>@domain → token.
 *
 * Checks every recipient field because the token may arrive on To, Cc, or
 * Delivered-To depending on how the client replied.
 */
export function extractConversationToken(
  recipients: (string | null | undefined)[],
  supportLocalPart = "support",
): string | null {
  const pattern = new RegExp(
    `\\b${escapeRegex(supportLocalPart)}\\+([a-z0-9]{4,64})@`,
    "i",
  );
  for (const value of recipients) {
    if (!value) continue;
    const match = value.match(pattern);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return null;
}

/** The Reply-To we put on every outbound message so layer 2 can work. */
export function replyToAddress(
  token: string,
  domain: string,
  supportLocalPart = "support",
): string {
  return `${supportLocalPart}+${token}@${domain}`;
}

// ---------------------------------------------------------------------------
// Layer 3 — subject heuristic
// ---------------------------------------------------------------------------

/**
 * Strip reply/forward prefixes so "Re: Re: FW: Billing" and "Billing" compare
 * equal. Covers common non-English prefixes because customers do not write
 * support email in English only.
 */
const REPLY_PREFIX =
  /^(?:\s*(?:re|aw|antw|sv|vs|ref|res|odp|fwd?|tr|enc|rif|回复|回覆|답장)\s*(?:\[\d+\])?\s*:\s*)+/i;

export function normalizeSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  let s = subject;
  // Loop: a single pass leaves "Re: Fwd: x" partially prefixed.
  for (let i = 0; i < 10; i++) {
    const next = s.replace(REPLY_PREFIX, "");
    if (next === s) break;
    s = next;
  }
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Prefix an outgoing reply subject once, never "Re: Re:". */
export function replySubject(subject: string | null | undefined): string {
  const base = (subject ?? "").trim();
  if (!base) return "Re: (no subject)";
  return REPLY_PREFIX.test(base) ? base : `Re: ${base}`;
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

export type ThreadMatch =
  | { strategy: "headers"; conversationId: string; matchedMessageId: string }
  | { strategy: "plus-address"; conversationId: string; token: string }
  | { strategy: "subject"; conversationId: string; confidence: "low" }
  | { strategy: "none" };

export interface ThreadResolvers {
  /** Conversation containing any of these Message-IDs. */
  byMessageIds(ids: string[]): Promise<{ conversationId: string; messageId: string } | null>;
  /** Conversation carrying this plus-address token. */
  byToken(token: string): Promise<string | null>;
  /** Most recent open conversation from this sender with this subject. */
  bySubject(args: {
    fromEmail: string;
    normalizedSubject: string;
    withinHours: number;
  }): Promise<string | null>;
}

export interface InboundEnvelope {
  fromEmail: string;
  recipients: (string | null | undefined)[];
  subject: string | null | undefined;
  inReplyTo: string | null | undefined;
  references: string | null | undefined;
}

/**
 * Resolve an inbound email to an existing conversation, or report none.
 * The caller creates a new conversation on "none".
 *
 * `subjectWindowHours` bounds layer 3: without it, an unrelated email months
 * later with the same subject would be glued onto a stale thread. Two weeks
 * is long enough for a slow back-and-forth and short enough to stay wrong
 * rarely.
 */
export async function resolveThread(
  envelope: InboundEnvelope,
  resolvers: ThreadResolvers,
  options: { supportLocalPart?: string; subjectWindowHours?: number } = {},
): Promise<ThreadMatch> {
  const { supportLocalPart = "support", subjectWindowHours = 24 * 14 } = options;

  // Layer 1 — headers.
  const candidates = threadCandidates(envelope);
  if (candidates.length > 0) {
    const hit = await resolvers.byMessageIds(candidates);
    if (hit) {
      return {
        strategy: "headers",
        conversationId: hit.conversationId,
        matchedMessageId: hit.messageId,
      };
    }
  }

  // Layer 2 — plus address.
  const token = extractConversationToken(envelope.recipients, supportLocalPart);
  if (token) {
    const conversationId = await resolvers.byToken(token);
    if (conversationId) {
      return { strategy: "plus-address", conversationId, token };
    }
  }

  // Layer 3 — subject heuristic, narrow on purpose.
  const normalizedSubject = normalizeSubject(envelope.subject);
  if (normalizedSubject.length >= 3 && envelope.fromEmail) {
    const conversationId = await resolvers.bySubject({
      fromEmail: envelope.fromEmail.toLowerCase(),
      normalizedSubject,
      withinHours: subjectWindowHours,
    });
    if (conversationId) {
      return { strategy: "subject", conversationId, confidence: "low" };
    }
  }

  return { strategy: "none" };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
