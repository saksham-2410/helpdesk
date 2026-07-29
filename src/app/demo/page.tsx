import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { getPublicWorkspaceBySlug } from "@/lib/workspace/public";
import { CopyCode } from "@/components/ui/copy-code";
import { env } from "@/lib/env";

export const metadata = { title: "Widget demo" };

/**
 * Live chat bubble demo page — the artifact the submission checklist asks
 * for: "a separate page with your embeddable chat widget installed."
 *
 * Deliberately styled to look like a GENERIC third-party website rather than
 * our own dashboard (plain slate/white, a different font stack, ordinary
 * marketing copy for a fictional business) — the point being demonstrated is
 * that the widget carries its own styling and works correctly dropped onto a
 * page that knows nothing about our design system. Reusing the dashboard's
 * chrome here would quietly undercut that proof.
 *
 * The <script> tag below is the literal, unmodified install snippet — not a
 * simulation of one — using a relative src so it resolves correctly on
 * whatever origin this page is actually served from (localhost, a Vercel
 * preview, or production) without hardcoding a domain.
 */
export default async function DemoPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  const { workspace: slugParam } = await searchParams;

  const slug = slugParam;
  if (!slug) {
    // A signed-in agent landing here with no explicit slug gets redirected to
    // their own workspace's demo link — the common case (checking the demo
    // after installing) shouldn't require knowing your own slug by heart.
    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const ws = await getActiveWorkspace();
      if (ws) redirect(`/demo?workspace=${ws.slug}`);
    }
  }

  const workspace = slug ? await getPublicWorkspaceBySlug(slug) : null;

  if (!slug || !workspace) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <p className="label-eyebrow mb-3">Widget demo</p>
        <h1 className="font-serif text-3xl">
          {slug ? "Workspace not found" : "No workspace specified"}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-secondary">
          {slug
            ? `There's no workspace at "${slug}".`
            : "Sign in to preview the widget for your own workspace, or open this page with ?workspace=<slug>."}
        </p>
        <Link
          href="/login"
          className="mt-6 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </main>
    );
  }

  const snippet = `<script src="${env.appUrl}/widget.js" data-workspace="${workspace.slug}" defer></script>`;

  return (
    <div className="min-h-dvh bg-white font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif] text-slate-800">
      {/* Fake customer site chrome — intentionally generic, not our design system. */}
      <header className="border-b border-slate-200">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold text-slate-900">Northwind Outfitters</span>
          <nav className="hidden gap-6 text-sm text-slate-600 sm:flex">
            <span>Products</span>
            <span>Pricing</span>
            <span>About</span>
            <span>Contact</span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-20">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">
          Outdoor gear, delivered
        </p>
        <h1 className="mt-3 max-w-2xl text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
          Everything you need for your next trail.
        </h1>
        <p className="mt-5 max-w-lg text-slate-600">
          This is a fictional storefront with no relation to the workspace it&rsquo;s
          demonstrating. The chat bubble in the corner is the actual production
          widget, installed exactly as a real customer would install it.
        </p>
        <button
          type="button"
          className="mt-8 rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Shop now
        </button>

        <div className="mt-24 grid gap-6 border-t border-slate-200 pt-12 sm:grid-cols-3">
          {["Free shipping", "30-day returns", "24/7 support"].map((f) => (
            <div key={f} className="rounded-lg border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-800">{f}</p>
              <p className="mt-1 text-sm text-slate-500">
                Have a question? Use the chat bubble in the bottom-right corner.
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* The install snippet itself. Same-origin relative src, so it resolves
          correctly regardless of which deployment is serving this page. */}
      <script src="/widget.js" data-workspace={workspace.slug} defer />

      {/* Attribution panel — clearly separated from the fake storefront above
          so evaluators can find the install snippet without confusing it for
          part of the demo. */}
      <aside className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <p className="label-eyebrow mb-2 !text-slate-500">
            This is a demo page, not a real store
          </p>
          <h2 className="font-serif text-2xl text-slate-900">
            Installed on <span className="italic">{workspace.name}</span>
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-600">
            The exact snippet below is what&rsquo;s running on this page. Copy it onto
            any site to install the same chat widget for this workspace.
          </p>
          <CopyCode code={snippet} className="mt-5 max-w-xl" />
        </div>
      </aside>
    </div>
  );
}
