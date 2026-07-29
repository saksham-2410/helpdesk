import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicWorkspaceBySlug } from "@/lib/workspace/public";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPublishedArticleBySlug } from "@/lib/kb/data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}) {
  const { slug, articleSlug } = await params;
  const workspace = await getPublicWorkspaceBySlug(slug);
  if (!workspace) return { title: "Help centre" };
  const supabase = await createServerSupabase();
  const article = await getPublishedArticleBySlug(supabase, workspace.id, articleSlug);
  return { title: article ? `${article.title} · ${workspace.name}` : "Article not found" };
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}) {
  const { slug, articleSlug } = await params;
  const workspace = await getPublicWorkspaceBySlug(slug);
  if (!workspace) notFound();

  const supabase = await createServerSupabase();
  const article = await getPublishedArticleBySlug(supabase, workspace.id, articleSlug);
  if (!article) notFound();

  return (
    <div className="min-h-dvh bg-canvas">
      <div className="mx-auto max-w-2xl px-6 py-14">
        <Link href={`/help/${workspace.slug}`} className="text-[0.8125rem] text-secondary hover:text-primary">
          ← {workspace.name} help centre
        </Link>

        <article className="mt-6">
          <h1 className="font-serif text-3xl leading-tight">{article.title}</h1>
          {/*
            body_html is sanitized server-side before it is ever written to
            the row (see lib/kb/sanitize.ts, applied in kb/actions.ts on every
            create/update) — this render trusts a value this app itself
            already scrubbed, the same posture the widget takes with escaped
            visitor text. Not re-sanitizing at render is a deliberate choice,
            not an oversight: the two sanitize calls would be redundant and
            the actual trust boundary is at the write, not the read.
          */}
          <div
            className="prose-kb mt-6"
            dangerouslySetInnerHTML={{ __html: article.body_html }}
          />
        </article>
      </div>
    </div>
  );
}
