/**
 * Telling "no session" apart from "auth service is down".
 *
 * supabase-js does not throw on a network failure — it resolves with an
 * `error` object. So an outage and a logged-out visitor both surface as
 * `user: null`, and without inspecting the error an incident looks
 * indistinguishable from normal traffic: every request quietly redirects to
 * /login and nothing reports a problem.
 *
 * Kept as a pure function, separate from proxy.ts, so the classification can
 * be tested directly instead of by simulating DNS failures.
 */

export interface AuthErrorLike {
  name?: string;
  status?: number;
}

export function isInfrastructureError(
  error: AuthErrorLike | null | undefined,
): boolean {
  if (!error) return false;

  // supabase-js wraps fetch/network failures in this.
  if (error.name === "AuthRetryableFetchError") return true;

  // Expected, benign: no cookie, or a cookie that failed to parse. This is the
  // overwhelmingly common case and must NOT be treated as an incident.
  if (
    error.name === "AuthSessionMissingError" ||
    error.name === "AuthInvalidTokenResponseError"
  ) {
    return false;
  }

  // A 4xx means the service answered and rejected the credential — the token
  // is bad, which is the visitor's problem, not ours. 5xx means the service
  // itself failed.
  if (typeof error.status === "number") return error.status >= 500;

  // No name and no status: something unrecognised went wrong at the transport
  // layer. Fail loud rather than reporting the visitor as signed out.
  return true;
}
