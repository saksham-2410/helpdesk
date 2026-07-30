import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArticleStatus, KbArticleDetail, KbArticleListItem, KbCategory, KbSearchResult } from "./types";

/**
 * Every function here takes the caller's own RLS-scoped client — never a
 * service-role client — same convention as lib/inbox/data.ts. The dashboard
 * functions rely on `kb_articles_member_all` (sees drafts too); the public
 * ones rely on `kb_articles_public_read` (published only), so the same
 * table serves both the agent editor and the anonymous help centre without
 * ever branching on "am I public or not" in application code.
 */

export async function listCategories(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KbCategory[]> {
  const { data, error } = await supabase
    .from("kb_categories")
    .select("id, name, slug, position")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });

  if (error) {
    console.error("[kb] listCategories failed", error);
    return [];
  }
  return data as KbCategory[];
}

export async function listArticles(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KbArticleListItem[]> {
  const { data, error } = await supabase
    .from("kb_articles")
    .select("id, title, slug, excerpt, status, category_id, updated_at, published_at")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[kb] listArticles failed", error);
    return [];
  }
  return data as KbArticleListItem[];
}

export async function getArticle(
  supabase: SupabaseClient,
  articleId: string,
): Promise<KbArticleDetail | null> {
  const { data, error } = await supabase
    .from("kb_articles")
    .select("id, workspace_id, title, slug, excerpt, status, category_id, body_html, updated_at, published_at")
    .eq("id", articleId)
    .maybeSingle();

  if (error) {
    console.error("[kb] getArticle failed", error);
    return null;
  }
  return data as KbArticleDetail | null;
}

export async function listPublishedArticles(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<KbArticleListItem[]> {
  const { data, error } = await supabase
    .from("kb_articles")
    .select("id, title, slug, excerpt, status, category_id, updated_at, published_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "published" satisfies ArticleStatus)
    .order("published_at", { ascending: false });

  if (error) {
    console.error("[kb] listPublishedArticles failed", error);
    return [];
  }
  return data as KbArticleListItem[];
}

export async function getPublishedArticleBySlug(
  supabase: SupabaseClient,
  workspaceId: string,
  slug: string,
): Promise<KbArticleDetail | null> {
  const { data, error } = await supabase
    .from("kb_articles")
    .select("id, workspace_id, title, slug, excerpt, status, category_id, body_html, updated_at, published_at")
    .eq("workspace_id", workspaceId)
    .eq("slug", slug)
    .eq("status", "published" satisfies ArticleStatus)
    .maybeSingle();

  if (error) {
    console.error("[kb] getPublishedArticleBySlug failed", error);
    return null;
  }
  return data as KbArticleDetail | null;
}

export async function searchArticles(
  supabase: SupabaseClient,
  workspaceId: string,
  query: string,
  limit = 5,
): Promise<KbSearchResult[]> {
  const { data, error } = await supabase.rpc("search_kb_articles", {
    ws: workspaceId,
    query,
    result_limit: limit,
  });

  if (error) {
    console.error("[kb] searchArticles failed", error);
    return [];
  }
  return data as KbSearchResult[];
}

/**
 * search_kb_articles only returns the author-written excerpt (short, often
 * vague teaser text) — fine for a "here's what might help" link, but not
 * enough for the AI draft-reply to ground concrete steps in without either
 * inventing detail or refusing to answer. This fetches the actual body for
 * a known set of already-published article ids.
 */
export async function getArticleBodies(
  supabase: SupabaseClient,
  articleIds: string[],
): Promise<Record<string, string>> {
  if (articleIds.length === 0) return {};

  const { data, error } = await supabase
    .from("kb_articles")
    .select("id, body_text")
    .in("id", articleIds);

  if (error) {
    console.error("[kb] getArticleBodies failed", error);
    return {};
  }
  return Object.fromEntries(data.map((a) => [a.id as string, a.body_text as string]));
}
