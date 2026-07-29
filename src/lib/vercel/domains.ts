import "server-only";
import { env, features } from "@/lib/env";

/**
 * Thin fetch wrapper over the Vercel REST API — no SDK dependency for three
 * endpoints. `features.customDomains` gates every call: without a token and
 * project id, callers are expected to check that flag first and degrade to
 * the "pending + here are the DNS records" path instead of calling in here.
 */

export interface VerificationRecord {
  type: string;
  domain: string;
  value: string;
  reason?: string;
}

export interface VercelDomainStatus {
  verified: boolean;
  verification: VerificationRecord[];
}

export class VercelApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "VercelApiError";
  }
}

function endpoint(path: string): string {
  const url = new URL(`https://api.vercel.com${path}`);
  if (env.vercelTeamId) url.searchParams.set("teamId", env.vercelTeamId);
  return url.toString();
}

async function vercelFetch(path: string, init: RequestInit = {}): Promise<VercelDomainStatus> {
  const res = await fetch(endpoint(path), {
    ...init,
    headers: {
      authorization: `Bearer ${env.vercelToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new VercelApiError(body?.error?.message ?? `Vercel API error (${res.status})`, res.status);
  }
  return { verified: Boolean(body.verified), verification: body.verification ?? [] };
}

export async function addProjectDomain(domain: string): Promise<VercelDomainStatus> {
  return vercelFetch(`/v10/projects/${env.vercelProjectId}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
}

export async function getProjectDomain(domain: string): Promise<VercelDomainStatus | null> {
  try {
    return await vercelFetch(
      `/v9/projects/${env.vercelProjectId}/domains/${encodeURIComponent(domain)}`,
    );
  } catch (err) {
    if (err instanceof VercelApiError && err.status === 404) return null;
    throw err;
  }
}

export async function verifyProjectDomain(domain: string): Promise<VercelDomainStatus> {
  return vercelFetch(
    `/v9/projects/${env.vercelProjectId}/domains/${encodeURIComponent(domain)}/verify`,
    { method: "POST" },
  );
}

export async function removeProjectDomain(domain: string): Promise<void> {
  await vercelFetch(`/v9/projects/${env.vercelProjectId}/domains/${encodeURIComponent(domain)}`, {
    method: "DELETE",
  });
}

export interface DomainConfigStatus {
  /** Whether DNS actually resolves to Vercel and a TLS cert can be issued.
   *  This is NOT the same thing as `verified` above — `verified` is an
   *  OWNERSHIP check (do you control this domain), and for a subdomain
   *  nobody else has claimed, Vercel returns verified:true immediately,
   *  before any DNS record has been added. Confirmed against Vercel's own
   *  docs after this exact confusion showed up live: a domain reported as
   *  "active" with zero DNS configured. `misconfigured` is what actually
   *  gates traffic + SSL. */
  misconfigured: boolean;
  recommendedCname: string | null;
}

/** GET /v6/domains/{domain}/config — the actual DNS/traffic check,
 *  independent of the ownership-only `verified` flag above. */
export async function getDomainConfig(domain: string): Promise<DomainConfigStatus> {
  const url = new URL(`https://api.vercel.com/v6/domains/${encodeURIComponent(domain)}/config`);
  if (env.vercelTeamId) url.searchParams.set("teamId", env.vercelTeamId);
  url.searchParams.set("projectIdOrName", env.vercelProjectId ?? "");

  const res = await fetch(url, {
    headers: { authorization: `Bearer ${env.vercelToken}` },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new VercelApiError(body?.error?.message ?? `Vercel API error (${res.status})`, res.status);
  }
  return {
    misconfigured: Boolean(body.misconfigured),
    recommendedCname: body.recommendedCNAME?.[0]?.value ?? null,
  };
}

/**
 * Best-effort DNS instructions when there's no Vercel token to ask for the
 * real ones — a subdomain (3+ labels, e.g. help.acme.com) needs a CNAME; a
 * bare apex domain (2 labels, e.g. acme.com) needs an A record instead,
 * since a CNAME cannot coexist with the other records an apex needs (MX,
 * etc). Recommending subdomains as the default (see settings UI copy) keeps
 * almost everyone on the simpler CNAME path.
 */
export function genericVerificationInstructions(domain: string): VerificationRecord[] {
  const labelCount = domain.split(".").length;
  if (labelCount <= 2) {
    return [{ type: "A", domain, value: "76.76.21.21" }];
  }
  return [{ type: "CNAME", domain, value: "cname.vercel-dns.com" }];
}

export function isCustomDomainsEnabled(): boolean {
  return features.customDomains;
}

export interface ResolvedDomainStatus {
  status: "pending" | "verifying" | "active";
  verification: VerificationRecord[];
}

/** Combines the ownership check (`verified`) with the actual DNS/traffic
 *  check (`misconfigured`) into the three-state status this app tracks.
 *  Ownership alone is not "active" — a fresh subdomain nobody else has
 *  claimed comes back verified:true immediately, before any DNS record
 *  exists, which is not the same as traffic actually routing to Vercel. */
export async function resolveDomainStatus(
  domain: string,
  ownership: VercelDomainStatus,
): Promise<ResolvedDomainStatus> {
  if (!ownership.verified) {
    return { status: "verifying", verification: ownership.verification };
  }
  const config = await getDomainConfig(domain);
  if (config.misconfigured) {
    return {
      status: "pending",
      verification: [
        { type: "CNAME", domain, value: config.recommendedCname ?? "cname.vercel-dns.com" },
      ],
    };
  }
  return { status: "active", verification: [] };
}
