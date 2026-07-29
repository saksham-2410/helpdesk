"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { compactRelativeTime } from "@/lib/inbox/format";
import { createCategory, deleteCategory, setArticleStatus, deleteArticle, type ActionState } from "./actions";
import type { KbArticleListItem, KbCategory } from "@/lib/kb/types";

const UNCATEGORIZED = "__none__";

export function KbList({
  categories,
  articles,
  publicUrl,
}: {
  categories: KbCategory[];
  articles: KbArticleListItem[];
  publicUrl: string;
}) {
  const [activeCategory, setActiveCategory] = useState<string>("all");

  const grouped = new Map<string, KbArticleListItem[]>();
  for (const a of articles) {
    const key = a.category_id ?? UNCATEGORIZED;
    grouped.set(key, [...(grouped.get(key) ?? []), a]);
  }

  const visibleCategories =
    activeCategory === "all" ? categories : categories.filter((c) => c.id === activeCategory);
  const showUncategorized =
    (activeCategory === "all" || activeCategory === UNCATEGORIZED) &&
    (grouped.get(UNCATEGORIZED)?.length ?? 0) > 0;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 overflow-y-auto px-6 py-8">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-3">
        <div>
          <p className="text-[0.8125rem] font-medium">Public help centre</p>
          <p className="text-machine">{publicUrl}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => window.open(publicUrl, "_blank", "noopener,noreferrer")}
        >
          View public page
        </Button>
      </section>

      <section className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <FilterPill active={activeCategory === "all"} onClick={() => setActiveCategory("all")}>
            All articles
          </FilterPill>
          {categories.map((c) => (
            <FilterPill key={c.id} active={activeCategory === c.id} onClick={() => setActiveCategory(c.id)}>
              {c.name}
            </FilterPill>
          ))}
        </div>
        <Link href="/kb/new">
          <Button variant="primary" size="sm">
            New article
          </Button>
        </Link>
      </section>

      <CategoryForm />

      <div className="space-y-8">
        {visibleCategories.map((c) => {
          const items = grouped.get(c.id) ?? [];
          if (activeCategory !== "all" && items.length === 0) return null;
          return (
            <CategoryGroup
              key={c.id}
              title={c.name}
              categoryId={c.id}
              articles={items}
              deletable
            />
          );
        })}

        {showUncategorized && (
          <CategoryGroup title="Uncategorized" articles={grouped.get(UNCATEGORIZED) ?? []} />
        )}

        {articles.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">
            No articles yet. Create your first one to populate the help centre.
          </p>
        )}
      </div>
    </div>
  );
}

function CategoryGroup({
  title,
  categoryId,
  articles,
  deletable,
}: {
  title: string;
  categoryId?: string;
  articles: KbArticleListItem[];
  deletable?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function handleDeleteCategory() {
    if (!categoryId) return;
    if (!confirm(`Delete category "${title}"? Articles inside become uncategorized.`)) return;
    startTransition(async () => {
      await deleteCategory(categoryId);
    });
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[0.8125rem] font-semibold uppercase tracking-wide text-secondary">
          {title} <span className="text-muted">({articles.length})</span>
        </h2>
        {deletable && (
          <button
            type="button"
            onClick={handleDeleteCategory}
            disabled={pending}
            className="text-machine text-danger-500 hover:underline disabled:opacity-50"
          >
            Delete category
          </button>
        )}
      </div>
      {articles.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default px-4 py-6 text-center text-xs text-muted">
          No articles in this category yet.
        </p>
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
          {articles.map((a) => (
            <ArticleRow key={a.id} article={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ArticleRow({ article }: { article: KbArticleListItem }) {
  const [pending, startTransition] = useTransition();

  function handleToggleStatus() {
    const next = article.status === "published" ? "draft" : "published";
    startTransition(async () => {
      await setArticleStatus(article.id, next);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${article.title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteArticle(article.id);
    });
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <Link href={`/kb/${article.id}`} className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium hover:underline">{article.title}</p>
        <p className="mt-0.5 text-machine">Updated {compactRelativeTime(article.updated_at)}</p>
      </Link>
      <Badge tone={article.status === "published" ? "success" : "neutral"}>
        {article.status === "published" ? "Published" : "Draft"}
      </Badge>
      <Button variant="ghost" size="sm" disabled={pending} onClick={handleToggleStatus}>
        {article.status === "published" ? "Unpublish" : "Publish"}
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={handleDelete}>
        Delete
      </Button>
    </li>
  );
}

function CategorySubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      Add
    </Button>
  );
}

function CategoryForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createCategory, {});
  return (
    <form action={formAction} className="flex items-end gap-2">
      <Field label="New category" htmlFor="category-name" className="w-56">
        <Input id="category-name" name="name" placeholder="Billing" required />
      </Field>
      <CategorySubmit />
      {state.error && <p className="pb-2 text-xs text-danger-500">{state.error}</p>}
    </form>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-xs bg-accent px-2 py-0.5 text-[0.6875rem] font-medium text-accent-text"
          : "rounded-xs px-2 py-0.5 text-[0.6875rem] font-medium text-secondary hover:bg-paper-200 dark:hover:bg-paper-800"
      }
    >
      {children}
    </button>
  );
}
