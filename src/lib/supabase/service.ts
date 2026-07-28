import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role client. BYPASSES ROW LEVEL SECURITY.
 *
 * Only two callers legitimately need this, and both act on behalf of someone
 * who has no Supabase identity at all:
 *
 *   - widget route handlers  (anonymous visitors on third-party sites)
 *   - the inbound email webhook (Resend, a machine)
 *
 * Because RLS is off for this client, **every query made through it must
 * filter by workspace_id explicitly**. There is no safety net here; the
 * database will happily return another tenant's rows. Treat each use as
 * security-sensitive code and scope it at the query.
 *
 * Never import this from a client component — the `server-only` guard above
 * turns that into a build error rather than a leaked key.
 */
export function createServiceSupabase() {
  return createClient(env.supabaseUrl, env.supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
