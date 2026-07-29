"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { sanitizeArticleHtml } from "@/lib/kb/sanitize";
import { slugify } from "@/lib/kb/slug";

export interface ActionState {
  error?: string;
}

/**
 * Authorization is RLS (`kb_articles_member_all` / `kb_categories_member_all`)
 * scoped to the caller's own workspace — same posture as inbox/actions.ts.
 * No separate admin-only gate: any agent can maintain the help centre, only
 * team membership (invites/roles) is admin-gated.
 */

const ArticleSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  bodyHtml: z.string().default(""),
  bodyText: z.string().default(""),
  excerpt: z.string().trim().max(280).optional(),
  categoryId: z.string().uuid().nullable(),
});

async function uniqueArticleSlug(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  workspaceId: string,
  base: string,
  excludeId?: string,
): Promise<string> {
  const root = base || "article";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    let query = supabase
      .from("kb_articles")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("slug", candidate);
    if (excludeId) query = query.neq("id", excludeId);
    const { data } = await query.maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now()}`;
}

export async function createArticle(formData: FormData): Promise<ActionState> {
  const parsed = ArticleSchema.safeParse({
    title: formData.get("title"),
    bodyHtml: formData.get("bodyHtml") ?? "",
    bodyText: formData.get("bodyText") ?? "",
    excerpt: formData.get("excerpt") || undefined,
    categoryId: (formData.get("categoryId") as string) || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();
  const slug = await uniqueArticleSlug(supabase, workspace.id, slugify(parsed.data.title));

  const { data, error } = await supabase
    .from("kb_articles")
    .insert({
      workspace_id: workspace.id,
      title: parsed.data.title,
      slug,
      body_html: sanitizeArticleHtml(parsed.data.bodyHtml),
      body_text: parsed.data.bodyText,
      excerpt: parsed.data.excerpt ?? null,
      category_id: parsed.data.categoryId,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Could not create article." };

  revalidatePath("/kb");
  redirect(`/kb/${data.id}`);
}

export async function updateArticle(
  articleId: string,
  formData: FormData,
): Promise<ActionState> {
  const parsed = ArticleSchema.safeParse({
    title: formData.get("title"),
    bodyHtml: formData.get("bodyHtml") ?? "",
    bodyText: formData.get("bodyText") ?? "",
    excerpt: formData.get("excerpt") || undefined,
    categoryId: (formData.get("categoryId") as string) || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const { error } = await supabase
    .from("kb_articles")
    .update({
      title: parsed.data.title,
      body_html: sanitizeArticleHtml(parsed.data.bodyHtml),
      body_text: parsed.data.bodyText,
      excerpt: parsed.data.excerpt ?? null,
      category_id: parsed.data.categoryId,
    })
    .eq("id", articleId)
    .eq("workspace_id", workspace.id);

  if (error) return { error: error.message };
  revalidatePath(`/kb/${articleId}`);
  revalidatePath("/kb");
  return {};
}

const StatusSchema = z.enum(["draft", "published"]);

export async function setArticleStatus(
  articleId: string,
  status: "draft" | "published",
): Promise<ActionState> {
  const parsed = StatusSchema.safeParse(status);
  if (!parsed.success) return { error: "Invalid status." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("kb_articles")
    .update({
      status: parsed.data,
      published_at: parsed.data === "published" ? new Date().toISOString() : null,
    })
    .eq("id", articleId);

  if (error) return { error: error.message };
  revalidatePath(`/kb/${articleId}`);
  revalidatePath("/kb");
  return {};
}

export async function deleteArticle(articleId: string): Promise<ActionState> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("kb_articles").delete().eq("id", articleId);
  if (error) return { error: error.message };
  revalidatePath("/kb");
  redirect("/kb");
}

const CategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80),
});

export async function createCategory(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = CategorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();
  const slug = await uniqueCategorySlug(supabase, workspace.id, slugify(parsed.data.name));

  const { count } = await supabase
    .from("kb_categories")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id);

  const { error } = await supabase.from("kb_categories").insert({
    workspace_id: workspace.id,
    name: parsed.data.name,
    slug,
    position: count ?? 0,
  });

  if (error) return { error: error.message };
  revalidatePath("/kb");
  return {};
}

async function uniqueCategorySlug(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  workspaceId: string,
  base: string,
): Promise<string> {
  const root = base || "category";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? root : `${root}-${attempt + 1}`;
    const { data } = await supabase
      .from("kb_categories")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("slug", candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now()}`;
}

export async function deleteCategory(categoryId: string): Promise<ActionState> {
  const supabase = await createServerSupabase();
  // Articles in this category are not deleted — category_id just goes null
  // (on delete set null, see 0001) — so removing a category never silently
  // takes published articles down with it.
  const { error } = await supabase.from("kb_categories").delete().eq("id", categoryId);
  if (error) return { error: error.message };
  revalidatePath("/kb");
  return {};
}
