import Link from "next/link";
import { PageHeader } from "@/components/ui/empty-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listCategories } from "@/lib/kb/data";
import { ArticleEditor } from "../article-editor";

export const metadata = { title: "New article" };

export default async function NewArticlePage() {
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();
  const categories = await listCategories(supabase, workspace.id);

  return (
    <>
      <PageHeader
        title="New article"
        description="Saved as a draft — nothing is visible on the public help centre until you publish it."
        actions={
          <Link href="/kb" className="text-[0.8125rem] text-secondary hover:text-primary">
            Cancel
          </Link>
        }
      />
      <ArticleEditor mode="create" categories={categories} />
    </>
  );
}
