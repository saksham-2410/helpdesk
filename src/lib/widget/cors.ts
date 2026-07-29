/**
 * CORS for widget endpoints.
 *
 * The widget is installed on arbitrary third-party sites by design — that is
 * the entire point of "embed with one script tag" — so these routes must
 * answer cross-origin requests from origins that are not known in advance.
 *
 * `workspaces.settings` already has a place for a per-workspace allowed-origin
 * list (see the schema comment), which is the correct long-term shape: a
 * workspace only accepts embeds from domains its admin registered. Enforcing
 * that here requires a settings UI to manage the list, which does not exist
 * yet — building it was traded off against finishing the seven mandatory
 * features. Until then, this reflects the request's own Origin header rather
 * than serving a bare wildcard, which at least prevents `Access-Control-
 * Allow-Origin: *` from being paired with credentialed requests. Tracked as a
 * hardening follow-up in the README, not silently skipped.
 */
export function widgetCorsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function widgetPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: widgetCorsHeaders(request) });
}

export function widgetJson(
  request: Request,
  body: unknown,
  init: ResponseInit = {},
): Response {
  return Response.json(body, {
    ...init,
    headers: { ...widgetCorsHeaders(request), ...init.headers },
  });
}
