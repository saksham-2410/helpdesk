import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

/**
 * Pure JWT sign/verify logic for widget visitor sessions, with the secret
 * passed explicitly rather than read from environment.
 *
 * Deliberately has no `server-only` guard and no dependency on `lib/env` —
 * both pull in Next.js server-boundary machinery that throws when imported
 * outside a Next.js build (including under a plain Node test runner). The
 * thin wrapper in `token.ts` supplies the secret from `env` for application
 * code; tests call the functions here directly with a fixture secret.
 */

const ALG = "HS256";
const ISSUER = "helpdesk-widget";
const TTL = "24h";

export interface VisitorClaims {
  workspaceId: string;
  contactId: string;
  conversationId: string;
}

export async function signVisitorToken(
  claims: VisitorClaims,
  secret: string,
): Promise<string> {
  return new SignJWT({ ...claims, scope: "widget-visitor" })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TTL)
    .sign(new TextEncoder().encode(secret));
}

export type VerifyResult =
  | { ok: true; claims: VisitorClaims }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyVisitorToken(
  token: string,
  secret: string,
): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
      algorithms: [ALG],
    });

    if (
      payload.scope !== "widget-visitor" ||
      typeof payload.workspaceId !== "string" ||
      typeof payload.contactId !== "string" ||
      typeof payload.conversationId !== "string"
    ) {
      return { ok: false, reason: "invalid" };
    }

    return {
      ok: true,
      claims: {
        workspaceId: payload.workspaceId,
        contactId: payload.contactId,
        conversationId: payload.conversationId,
      },
    };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

/** Extract a bearer token from an Authorization header, or null. */
export function bearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}
