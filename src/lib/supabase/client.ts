"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client. Holds only the anon key, which is safe to ship —
 * RLS is what actually protects the data, not the key.
 *
 * Used for auth forms and for Realtime subscriptions in the agent dashboard.
 * The chat widget deliberately does NOT use this: it runs on third-party sites
 * and gets a short-lived, server-minted visitor token instead.
 */
let client: ReturnType<typeof createBrowserClient> | undefined;

export function createBrowserSupabase() {
  // Memoised: a fresh client per render would open a new Realtime socket each
  // time and leak connections across navigations.
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
