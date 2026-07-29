/**
 * In-memory sliding-window rate limiter.
 *
 * Deliberately not a production-grade solution — a single serverless
 * instance's memory does not coordinate across regions or cold starts, so
 * this is a soft ceiling, not a hard guarantee. It is enough to blunt casual
 * abuse of the widget and webhook endpoints without adding a Redis dependency
 * to a 48-hour build.
 *
 * The real answer is Upstash's Redis-backed limiter (works natively with
 * Vercel's edge network); swapping this module for that one is a drop-in
 * change because the call site only needs `{ ok, remaining, resetAt }`. Noted
 * as a known limitation in the README rather than pretended away.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bound memory growth: an unbounded Map fed by attacker-controlled keys (IPs)
// is itself a denial-of-service vector. Old entries are swept opportunistically
// rather than on a timer, which would keep a serverless instance alive for no
// reason.
const MAX_BUCKETS = 5000;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) sweep(now);

  const existing = buckets.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  existing.count += 1;
  const resetAt = existing.windowStart + windowMs;

  if (existing.count > limit) {
    return { ok: false, remaining: 0, resetAt };
  }

  return { ok: true, remaining: limit - existing.count, resetAt };
}

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    // A bucket outside any plausible window is dead weight either way.
    if (now - bucket.windowStart > 10 * 60 * 1000) buckets.delete(key);
  }
}

/** Best-effort client identifier for a Request, for keying the limiter. */
export function clientKey(request: Request, extra = ""): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0]!.trim() : "unknown";
  return extra ? `${ip}:${extra}` : ip;
}

/** Only exported for tests — production code should never reset shared state. */
export function __resetRateLimitStateForTests() {
  buckets.clear();
}
