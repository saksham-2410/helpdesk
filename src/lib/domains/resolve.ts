/**
 * Deliberately NOT importing lib/env.ts (which throws on a missing var) or
 * lib/supabase/server.ts (which needs next/headers' cookie jar, unavailable
 * in the shape proxy.ts wants). This runs on every request whose host isn't
 * recognized as the app's own — it takes the same "never take the whole site
 * down" posture proxy.ts already applies to auth: read env vars as plain
 * strings, and any failure here just means "not a custom domain," not a
 * crash.
 */

const OWN_HOST_PATTERNS = [/\.vercel\.app$/, /^localhost(:\d+)?$/, /^127\.0\.0\.1(:\d+)?$/];

export function looksLikeOwnHost(host: string): boolean {
  if (OWN_HOST_PATTERNS.some((p) => p.test(host))) return true;
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) {
    try {
      if (new URL(explicit).host === host) return true;
    } catch {
      // Malformed env value — fall through to "not a known own host" rather
      // than throwing.
    }
  }
  return false;
}

/** Resolves a request Host header to the workspace slug it should serve the
 *  public help centre for, or null if it isn't a connected, active domain. */
export async function resolveCustomDomainSlug(
  host: string,
  supabaseUrl: string,
  supabaseAnonKey: string,
): Promise<string | null> {
  const url = new URL(`${supabaseUrl}/rest/v1/workspace_domains`);
  url.searchParams.set("select", "workspace:workspaces(slug)");
  url.searchParams.set("domain", `eq.${host}`);
  url.searchParams.set("status", "eq.active");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: { apikey: supabaseAnonKey, authorization: `Bearer ${supabaseAnonKey}` },
    // Domain connections change rarely; avoid re-fetching on every request
    // to the same custom domain within a short window.
    next: { revalidate: 60 },
  });
  if (!res.ok) return null;

  const rows = (await res.json()) as { workspace: { slug: string } | null }[];
  return rows[0]?.workspace?.slug ?? null;
}
