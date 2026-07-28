import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isInfrastructureError } from "./errors";

describe("isInfrastructureError", () => {
  test("no error is not an incident", () => {
    assert.equal(isInfrastructureError(null), false);
    assert.equal(isInfrastructureError(undefined), false);
  });

  test("a logged-out visitor is not an incident", () => {
    // By far the most common case. Misclassifying this would 503 every
    // anonymous request to a protected route instead of redirecting to login.
    assert.equal(
      isInfrastructureError({ name: "AuthSessionMissingError", status: 400 }),
      false,
    );
  });

  test("an unparseable cookie is not an incident", () => {
    assert.equal(
      isInfrastructureError({ name: "AuthInvalidTokenResponseError" }),
      false,
    );
  });

  test("a network failure IS an incident", () => {
    assert.equal(isInfrastructureError({ name: "AuthRetryableFetchError" }), true);
  });

  test("a rejected credential is not an incident — the service answered", () => {
    assert.equal(isInfrastructureError({ status: 401 }), false);
    assert.equal(isInfrastructureError({ status: 403 }), false);
  });

  test("a 5xx from the auth service IS an incident", () => {
    assert.equal(isInfrastructureError({ status: 500 }), true);
    assert.equal(isInfrastructureError({ status: 503 }), true);
  });

  test("an unrecognised failure fails loud rather than reporting signed-out", () => {
    assert.equal(isInfrastructureError({}), true);
  });
});
