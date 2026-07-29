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
