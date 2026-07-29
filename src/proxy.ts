import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isInfrastructureError } from "@/lib/auth/errors";

/**
 * Next.js 16 renamed `middleware` to `proxy`. It runs on the Node.js runtime
 * (the edge runtime is not supported here), which is convenient later: the
 * custom-domain host lookup in feature 7 can hit the database directly.
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie. Server Components cannot write
 *      cookies, so if this does not run the session silently expires mid-use.
 *   2. Gate the agent dashboard behind auth.
 */

/** Prefixes that must never require a session. */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/invite",
  "/auth",
  "/help", // public knowledge base
  "/demo", // widget demo page the evaluators will open
  "/styleguide",
  "/api/widget", // anonymous visitors on third-party sites
  "/api/webhooks", // Resend inbound, signature-verified instead
];

/** Signed-in users have no reason to see these. */
const AUTH_ONLY_PAGES = ["/login", "/signup"];

function isPublic(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}


export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Misconfiguration must not take down the whole site. This runs on every
  // request, so any unguarded failure here — missing credentials, a malformed
  // URL, a network error — turns into a 500 on every route, including fully
  // static pages that need no database at all.
  //
  // Everything from client construction through the auth check is therefore
  // one try/catch. `createServerClient()` throws SYNCHRONOUSLY on a malformed
  // URL (e.g. `new URL()` failing inside the SDK) — that failure happens
  // before any cookie or await is involved, so it is not enough to wrap only
  // the network call; the constructor call must be inside the same guard.
  let response = NextResponse.next({ request });
  let user = null;
  let authUnavailable = !supabaseUrl || !supabaseAnonKey;

  if (!authUnavailable) {
    try {
      // Cookie plumbing per @supabase/ssr: writes must land on BOTH the
      // forwarded request (so this render sees the fresh token) and the
      // outgoing response (so the browser stores it).
      const supabase = createServerClient(supabaseUrl!, supabaseAnonKey!, {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value } of cookiesToSet) {
              request.cookies.set(name, value);
            }
            response = NextResponse.next({ request });
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      });

      // getUser() verifies the JWT with the auth server. getSession() only
      // decodes the cookie and is therefore spoofable — never gate access on
      // it. Note supabase-js does not throw on a network failure — it
      // resolves with an `error` instead — so "no session" and "cannot reach
      // the auth service" both arrive as `user: null` and have to be told
      // apart by inspecting the error (see isInfrastructureError), or an
      // outage silently looks like every visitor being signed out.
      const { data, error } = await supabase.auth.getUser();
      user = data.user;
      if (error && isInfrastructureError(error)) authUnavailable = true;
    } catch {
      // Anything unexpected — malformed URL, DNS failure, a bad key format —
      // degrades to the same "service unavailable" path rather than crashing
      // the proxy. A misconfigured deployment must not take the whole site
      // down for every visitor.
      authUnavailable = true;
    }
  }

  // Public routes render regardless. Authenticated routes must not silently
  // fall through unauthenticated, so they get an honest 503 instead.
  if (authUnavailable) {
    if (isPublic(pathname)) return response;
    return new NextResponse(
      "Service unavailable: cannot reach the authentication service.",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  if (!user && !isPublic(pathname)) {
    // An authenticated API route (e.g. /api/conversations/[id]/summary,
    // fetched client-side from the inbox) must fail as JSON, not as a
    // redirect to an HTML login page — fetch() follows redirects
    // transparently, so the caller would otherwise see a 200 with an HTML
    // body instead of a 401 it can actually branch on.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in." }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve intent so the user lands where they were headed after signing in.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ONLY_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/inbox";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  /**
   * Skip static assets and the widget bundle. widget.js is embedded on
   * third-party sites and must never be redirected to a login page.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|widget.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
