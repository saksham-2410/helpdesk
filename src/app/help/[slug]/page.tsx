import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicWorkspaceBySlug } from "@/lib/workspace/public";
import { createServerSupabase } from "@/lib/supabase/server";
import { listCategories, listPublishedArticles } from "@/lib/kb/data";
import { HelpSearch } from "./help-search";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const workspace = await getPublicWorkspaceBySlug(slug);
  return { title: workspace ? `Help centre · ${workspace.name}` : "Help centre" };
}

export default async function HelpCentrePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const workspace = await getPublicWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const supabase = await createServerSupabase();
  const [categories, articles] = await Promise.all([
    listCategories(supabase, workspace.id),
    listPublishedArticles(supabase, workspace.id),
  ]);

  const grouped = new Map<string, typeof articles>();
  for (const a of articles) {
    const key = a.category_id ?? "__none__";
    grouped.set(key, [...(grouped.get(key) ?? []), a]);
  }

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="texture-grain relative overflow-hidden border-b border-border-subtle bg-surface px-6 py-16 text-center">
        <p className="label-eyebrow mb-3">{workspace.name}</p>
        <h1 className="font-serif text-4xl leading-tight">How can we help?</h1>
        <div className="mx-auto mt-7 max-w-md">
          <HelpSearch workspaceSlug={workspace.slug} />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        {articles.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted">
            No articles have been published yet.
          </p>
        ) : (
          <div className="space-y-10">
            {categories.map((c) => {
              const items = grouped.get(c.id) ?? [];
              if (items.length === 0) return null;
              return (
                <section key={c.id}>
                  <h2 className="font-serif text-xl">{c.name}</h2>
                  <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
                    {items.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/help/${workspace.slug}/${a.slug}`}
                          className="block px-4 py-3.5 transition-colors hover:bg-paper-100 dark:hover:bg-paper-800"
                        >
                          <p className="text-sm font-medium">{a.title}</p>
                          {a.excerpt && (
                            <p className="mt-0.5 line-clamp-1 text-[0.8125rem] text-secondary">
                              {a.excerpt}
                            </p>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}

            {(grouped.get("__none__")?.length ?? 0) > 0 && (
              <section>
                <h2 className="font-serif text-xl">More articles</h2>
                <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
                  {(grouped.get("__none__") ?? []).map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/help/${workspace.slug}/${a.slug}`}
                        className="block px-4 py-3.5 transition-colors hover:bg-paper-100 dark:hover:bg-paper-800"
                      >
                        <p className="text-sm font-medium">{a.title}</p>
                        {a.excerpt && (
                          <p className="mt-0.5 line-clamp-1 text-[0.8125rem] text-secondary">
                            {a.excerpt}
                          </p>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
