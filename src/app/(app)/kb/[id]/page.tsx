import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { getArticle, listCategories } from "@/lib/kb/data";
import { env } from "@/lib/env";
import { ArticleEditor } from "../article-editor";
import { ArticleHeader } from "./article-header";

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const [article, categories] = await Promise.all([
    getArticle(supabase, id),
    listCategories(supabase, workspace.id),
  ]);

  if (!article) notFound();

  return (
    <>
      <ArticleHeader
        articleId={article.id}
        title={article.title}
        status={article.status}
        publicUrl={`${env.appUrl}/help/${workspace.slug}/${article.slug}`}
      />
      <ArticleEditor mode="edit" article={article} categories={categories} />
    </>
  );
}
