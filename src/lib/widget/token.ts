import "server-only";
import { env } from "@/lib/env";
import * as core from "./token-core";

/**
 * Visitor session tokens — application entry point.
 *
 * The widget runs on a third-party site with no Supabase session — there is
 * no `auth.uid()` to hang RLS off. Instead, `/api/widget/session` mints a
 * short-lived JWT binding the visitor to exactly one workspace, contact, and
 * conversation. Every subsequent widget request must present it, and the
 * server trusts ONLY the ids inside the verified token — never an id supplied
 * in the request body or query string.
 *
 * This is the difference between "the widget can act for its own visitor"
 * and "the widget can act for anyone" (an IDOR: pass someone else's
 * conversationId and read their transcript). Signed with
 * SUPABASE_JWT_SECRET so it rides on infrastructure that already exists
 * rather than a fourth secret to provision and rotate.
 *
 * The actual sign/verify logic lives in `token-core.ts` (no `server-only`,
 * secret passed explicitly) so it can be unit tested outside Next.js; this
 * module just injects the real secret from `env`.
 */

export type { VisitorClaims, VerifyResult } from "./token-core";
export { bearerToken } from "./token-core";

export async function signVisitorToken(claims: core.VisitorClaims): Promise<string> {
  return core.signVisitorToken(claims, env.supabaseJwtSecret);
}

export async function verifyVisitorToken(token: string): Promise<core.VerifyResult> {
  return core.verifyVisitorToken(token, env.supabaseJwtSecret);
}
