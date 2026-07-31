import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiter with an optional Redis-backed path.
 *
 * Without UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN set, this falls
 * back to the in-memory sliding window below — a single serverless
 * instance's memory does not coordinate across regions or cold starts, so
 * it's a soft ceiling, not a hard guarantee. Fine for blunting casual abuse
 * at low volume; the real ceiling at higher concurrency is exactly this gap
 * (20 instances each enforcing their own "30 per 10 min" is actually 600).
 *
 * With those two env vars set, every call is enforced against one shared
 * Redis-backed sliding window instead, so the limit means what it says
 * regardless of how many instances are running. Same call sites, same
 * `{ok, remaining, resetAt}` result shape — this was always meant to be a
 * drop-in swap, not a rewrite.
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

/** The original in-memory implementation, kept directly testable (and as
 *  the fallback) under its own name now that `rateLimit` below is async. */
export function rateLimitMemory(
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

// --- Optional Redis backing --------------------------------------------

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = upstashUrl && upstashToken ? new Redis({ url: upstashUrl, token: upstashToken }) : null;

// Ratelimit.slidingWindow's config is fixed at construction, but call sites
// here pass different (limit, windowMs) pairs per route — so instances are
// built lazily per distinct pair and reused, rather than one-per-call.
const limiters = new Map<string, Ratelimit>();

function getRedisLimiter(limit: number, windowMs: number): Ratelimit {
  const cacheKey = `${limit}:${windowMs}`;
  let limiter = limiters.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: redis!,
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      analytics: false,
      // Every route already namespaces its own key via clientKey()'s
      // `extra` suffix — no need for Ratelimit's own prefix on top.
      prefix: "hd",
    });
    limiters.set(cacheKey, limiter);
  }
  return limiter;
}

export async function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): Promise<RateLimitResult> {
  if (!redis) return rateLimitMemory(key, options);

  try {
    const result = await getRedisLimiter(options.limit, options.windowMs).limit(key);
    return { ok: result.success, remaining: result.remaining, resetAt: result.reset };
  } catch (err) {
    // Redis down or misconfigured must not take the route down with it —
    // degrade to the in-memory window rather than failing every request
    // (or, worse, failing open with no limit at all).
    console.error("[rate-limit] Redis limiter failed, falling back to in-memory", err);
    return rateLimitMemory(key, options);
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
