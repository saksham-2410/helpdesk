/**
 * Default export for route-segment `loading.tsx` files. Next.js wraps the
 * segment in a Suspense boundary keyed to this file, so navigating to it
 * swaps this in immediately instead of leaving the previous page frozen
 * on screen for the length of the segment's data fetch (auth check +
 * workspace lookup + the page's own query, all server-verified per
 * navigation — see lib/supabase/server.ts).
 */
export default function RouteLoading() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <span
        aria-hidden
        className="size-6 animate-spin rounded-full border-2 border-border-default border-t-accent"
      />
    </div>
  );
}
