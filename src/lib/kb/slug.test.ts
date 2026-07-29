import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug";

describe("slugify", () => {
  test("lowercases and hyphenates", () => {
    assert.equal(slugify("Refund Policy"), "refund-policy");
  });

  test("collapses runs of punctuation into one hyphen", () => {
    assert.equal(slugify("What's the SLA?  (Enterprise)"), "whats-the-sla-enterprise");
  });

  test("trims leading and trailing hyphens", () => {
    assert.equal(slugify("  -- Getting Started! -- "), "getting-started");
  });

  test("caps length at 80 characters", () => {
    const long = "a".repeat(200);
    assert.equal(slugify(long).length, 80);
  });

  test("empty input yields empty slug", () => {
    assert.equal(slugify("   "), "");
  });
});
