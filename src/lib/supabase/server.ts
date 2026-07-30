import "server-only";
import { cache } from "react";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Request-scoped Supabase client for Server Components, Server Actions, and
 * Route Handlers. Carries the signed-in user's session, so every query it
 * makes is subject to RLS — this is the client that should be used for
 * essentially all application code.
 *
 * Note `cookies()` is awaited: Next.js 16 removed synchronous access to
 * request APIs entirely.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. Session refresh is handled
          // in proxy.ts, so swallowing this is correct rather than merely
          // convenient — the refreshed cookie is written there.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null. Uses getUser() rather than getSession():
 * getSession() reads the cookie without verifying it against the auth server,
 * so it can be spoofed by a forged cookie. Never authorize on getSession().
 *
 * Wrapped in React's `cache()` so the several server components that call
 * this during one render (layout, page, nested data loaders) share a single
 * round trip to the auth server instead of each paying for their own —
 * getUser() is a real network call, not a local cookie decode, so this
 * directly matters for perceived navigation speed.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
