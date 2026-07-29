import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, clientKey, __resetRateLimitStateForTests } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
  });

  test("allows requests under the limit", () => {
    const r1 = rateLimit("a", { limit: 3, windowMs: 1000 });
    const r2 = rateLimit("a", { limit: 3, windowMs: 1000 });
    assert.equal(r1.ok, true);
    assert.equal(r1.remaining, 2);
    assert.equal(r2.ok, true);
    assert.equal(r2.remaining, 1);
  });

  test("blocks once the limit is exceeded within the window", () => {
    rateLimit("b", { limit: 2, windowMs: 1000 });
    rateLimit("b", { limit: 2, windowMs: 1000 });
    const third = rateLimit("b", { limit: 2, windowMs: 1000 });
    assert.equal(third.ok, false);
    assert.equal(third.remaining, 0);
  });

  test("different keys do not share a bucket", () => {
    rateLimit("x", { limit: 1, windowMs: 1000 });
    const other = rateLimit("y", { limit: 1, windowMs: 1000 });
    assert.equal(other.ok, true);
  });

  test("resets after the window elapses", async () => {
    rateLimit("c", { limit: 1, windowMs: 20 });
    const blocked = rateLimit("c", { limit: 1, windowMs: 20 });
    assert.equal(blocked.ok, false);

    await new Promise((r) => setTimeout(r, 30));

    const afterReset = rateLimit("c", { limit: 1, windowMs: 20 });
    assert.equal(afterReset.ok, true);
  });
});

describe("clientKey", () => {
  test("uses the first hop of X-Forwarded-For", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    assert.equal(clientKey(req), "1.2.3.4");
  });

  test("falls back to unknown without the header", () => {
    const req = new Request("http://x");
    assert.equal(clientKey(req), "unknown");
  });

  test("appends the extra scope so one IP has independent buckets per route", () => {
    const req = new Request("http://x", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    assert.equal(clientKey(req, "widget-send"), "1.2.3.4:widget-send");
  });
});
