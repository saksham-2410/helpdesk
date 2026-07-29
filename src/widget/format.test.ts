import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mergeMessages,
  reconcileOptimistic,
  latestTimestamp,
  escapeHtml,
  type WidgetMessage,
} from "./format";

function msg(id: string, createdAt: string, overrides: Partial<WidgetMessage> = {}): WidgetMessage {
  return { id, authorType: "contact", bodyText: `msg ${id}`, createdAt, ...overrides };
}

describe("mergeMessages", () => {
  test("de-duplicates by id regardless of which list a message came from", () => {
    const a = [msg("1", "2026-01-01T00:00:00Z")];
    const b = [msg("1", "2026-01-01T00:00:00Z"), msg("2", "2026-01-01T00:00:01Z")];
    const result = mergeMessages(a, b);
    assert.equal(result.length, 2);
    assert.deepEqual(result.map((m) => m.id), ["1", "2"]);
  });

  test("sorts by createdAt regardless of input order", () => {
    const result = mergeMessages(
      [msg("late", "2026-01-01T00:00:05Z"), msg("early", "2026-01-01T00:00:01Z")],
      [msg("mid", "2026-01-01T00:00:03Z")],
    );
    assert.deepEqual(result.map((m) => m.id), ["early", "mid", "late"]);
  });

  test("is idempotent — merging the same set again does not reorder it", () => {
    const set = [msg("a", "2026-01-01T00:00:00.000Z"), msg("b", "2026-01-01T00:00:00.000Z")];
    const once = mergeMessages([], set);
    const twice = mergeMessages(once, set);
    assert.deepEqual(
      twice.map((m) => m.id),
      once.map((m) => m.id),
    );
  });

  test("breaks same-millisecond ties deterministically by id", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const result = mergeMessages([], [msg("zzz", t), msg("aaa", t)]);
    assert.deepEqual(result.map((m) => m.id), ["aaa", "zzz"]);
  });

  test("a later write for the same id wins (e.g. server payload over a stale echo)", () => {
    const stale = msg("1", "2026-01-01T00:00:00Z", { bodyText: "stale" });
    const fresh = msg("1", "2026-01-01T00:00:00Z", { bodyText: "fresh" });
    const result = mergeMessages([stale], [fresh]);
    assert.equal(result.length, 1);
    assert.equal(result[0]!.bodyText, "fresh");
  });
});

describe("reconcileOptimistic", () => {
  test("swaps the temporary id for the confirmed message", () => {
    const optimistic = msg("temp-1", "2026-01-01T00:00:00Z", { pending: true, bodyText: "hi" });
    const confirmed = msg("real-42", "2026-01-01T00:00:00.500Z", { bodyText: "hi" });

    const result = reconcileOptimistic([optimistic], "temp-1", confirmed);

    assert.equal(result.length, 1);
    assert.equal(result[0]!.id, "real-42");
    assert.equal(result[0]!.pending, undefined);
  });

  test("adds the confirmed message even if the placeholder is already gone", () => {
    // Broadcast delivery can beat the POST response back to the client.
    const confirmed = msg("real-42", "2026-01-01T00:00:00Z");
    const result = reconcileOptimistic([], "temp-1", confirmed);
    assert.deepEqual(result.map((m) => m.id), ["real-42"]);
  });

  test("does not disturb other pending messages", () => {
    const otherPending = msg("temp-2", "2026-01-01T00:00:01Z", { pending: true });
    const thisPending = msg("temp-1", "2026-01-01T00:00:00Z", { pending: true });
    const confirmed = msg("real-1", "2026-01-01T00:00:00Z");

    const result = reconcileOptimistic([thisPending, otherPending], "temp-1", confirmed);

    assert.equal(result.length, 2);
    assert.ok(result.some((m) => m.id === "temp-2" && m.pending));
    assert.ok(result.some((m) => m.id === "real-1"));
  });
});

describe("latestTimestamp", () => {
  test("returns null for an empty list", () => {
    assert.equal(latestTimestamp([]), null);
  });

  test("finds the max regardless of input order", () => {
    const result = latestTimestamp([
      msg("1", "2026-01-01T00:00:00Z"),
      msg("2", "2026-01-03T00:00:00Z"),
      msg("3", "2026-01-02T00:00:00Z"),
    ]);
    assert.equal(result, "2026-01-03T00:00:00Z");
  });
});

describe("escapeHtml", () => {
  test("escapes the five HTML-significant characters", () => {
    assert.equal(escapeHtml(`<script>&"'`), "&lt;script&gt;&amp;&quot;&#39;");
  });

  test("leaves ordinary text untouched", () => {
    assert.equal(escapeHtml("Hello, world! 123"), "Hello, world! 123");
  });
});
