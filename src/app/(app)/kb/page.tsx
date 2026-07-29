import { PageHeader } from "@/components/ui/empty-state";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { listCategories, listArticles } from "@/lib/kb/data";
import { env } from "@/lib/env";
import { KbList } from "./kb-list";

export const metadata = { title: "Knowledge base" };

export default async function KbPage() {
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const [categories, articles] = await Promise.all([
    listCategories(supabase, workspace.id),
    listArticles(supabase, workspace.id),
  ]);

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Help articles for your customers, and answers the widget can suggest."
      />
      <KbList
        categories={categories}
        articles={articles}
        publicUrl={`${env.appUrl}/help/${workspace.slug}`}
      />
    </>
  );
}
