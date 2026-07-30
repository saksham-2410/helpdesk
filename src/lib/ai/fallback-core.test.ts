import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractJson } from "./fallback-core";

describe("extractJson", () => {
  test("parses a clean JSON object", () => {
    const result = extractJson<{ draft_reply: string }>('{"draft_reply": "Hi there."}');
    assert.deepEqual(result, { draft_reply: "Hi there." });
  });

  test("unwraps a ```json fenced block", () => {
    const text = '```json\n{"draft_reply": "Hi there."}\n```';
    const result = extractJson<{ draft_reply: string }>(text);
    assert.deepEqual(result, { draft_reply: "Hi there." });
  });

  test("unwraps a fenced block with no language tag", () => {
    const text = '```\n{"draft_reply": "Hi there."}\n```';
    const result = extractJson<{ draft_reply: string }>(text);
    assert.deepEqual(result, { draft_reply: "Hi there." });
  });

  test("extracts the object out of surrounding prose", () => {
    const text = 'Sure, here is the reply:\n{"draft_reply": "Hi there."}\nLet me know if you need changes.';
    const result = extractJson<{ draft_reply: string }>(text);
    assert.deepEqual(result, { draft_reply: "Hi there." });
  });

  test("throws on genuinely non-JSON text", () => {
    assert.throws(() => extractJson("Sorry, I can't help with that."));
  });
});
