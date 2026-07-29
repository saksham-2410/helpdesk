export type ArticleStatus = "draft" | "published";

export interface KbCategory {
  id: string;
  name: string;
  slug: string;
  position: number;
}

export interface KbArticleListItem {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  status: ArticleStatus;
  category_id: string | null;
  updated_at: string;
  published_at: string | null;
}

export interface KbArticleDetail extends KbArticleListItem {
  workspace_id: string;
  body_html: string;
}

export interface KbSearchResult {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  rank: number;
}
