import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { signVisitorToken, verifyVisitorToken, bearerToken } from "./token-core";

// Tests target token-core.ts directly (secret passed explicitly, no `env`
// dependency) rather than token.ts, which carries the `server-only` guard —
// that guard throws when imported outside a Next.js build, including under a
// plain Node test runner. token.ts is a thin wrapper with nothing left to
// unit test once this module is covered.

const SECRET = "test-secret-at-least-32-bytes-long!!";

describe("visitor tokens", () => {
  const claims = {
    workspaceId: "11111111-1111-1111-1111-111111111111",
    contactId: "22222222-2222-2222-2222-222222222222",
    conversationId: "33333333-3333-3333-3333-333333333333",
  };

  test("round-trips the claims that were signed", async () => {
    const token = await signVisitorToken(claims, SECRET);
    const result = await verifyVisitorToken(token, SECRET);
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.claims, claims);
  });

  test("rejects a token signed with a different secret", async () => {
    const wrongKey = new TextEncoder().encode("a-completely-different-secret-value");
    const forged = await new SignJWT({ ...claims, scope: "widget-visitor" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("helpdesk-widget")
      .setExpirationTime("1h")
      .sign(wrongKey);

    const result = await verifyVisitorToken(forged, SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
  });

  test("rejects a token missing the widget-visitor scope", async () => {
    const key = new TextEncoder().encode(SECRET);
    // Same secret, same shape, wrong scope — must not be treated as a valid
    // visitor session just because the signature checks out. A JWT signed for
    // a different purpose sharing the same secret must not be reusable here.
    const wrongScope = await new SignJWT({ ...claims, scope: "something-else" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("helpdesk-widget")
      .setExpirationTime("1h")
      .sign(key);

    const result = await verifyVisitorToken(wrongScope, SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "invalid");
  });

  test("rejects an expired token with a distinct reason", async () => {
    const key = new TextEncoder().encode(SECRET);
    const expired = await new SignJWT({ ...claims, scope: "widget-visitor" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("helpdesk-widget")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(key);

    const result = await verifyVisitorToken(expired, SECRET);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "expired");
  });

  test("rejects garbage input without throwing", async () => {
    const result = await verifyVisitorToken("not-a-jwt-at-all", SECRET);
    assert.equal(result.ok, false);
  });

  test("rejects a token missing a required claim", async () => {
    const key = new TextEncoder().encode(SECRET);
    const partial = await new SignJWT({
      workspaceId: claims.workspaceId,
      scope: "widget-visitor",
      // contactId and conversationId omitted
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("helpdesk-widget")
      .setExpirationTime("1h")
      .sign(key);

    const result = await verifyVisitorToken(partial, SECRET);
    assert.equal(result.ok, false);
  });
});

describe("bearerToken", () => {
  test("extracts the token from a well-formed header", () => {
    assert.equal(bearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
  });

  test("is case-insensitive on the scheme", () => {
    assert.equal(bearerToken("bearer abc"), "abc");
  });

  test("returns null for a missing or malformed header", () => {
    assert.equal(bearerToken(null), null);
    assert.equal(bearerToken("Basic abc"), null);
    assert.equal(bearerToken(""), null);
  });
});
