"use client";

import { useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { setArticleStatus, deleteArticle } from "../actions";
import type { ArticleStatus } from "@/lib/kb/types";

export function ArticleHeader({
  articleId,
  title,
  status,
  publicUrl,
}: {
  articleId: string;
  title: string;
  status: ArticleStatus;
  publicUrl: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    const next = status === "published" ? "draft" : "published";
    startTransition(async () => {
      await setArticleStatus(articleId, next);
    });
  }

  function handleDelete() {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await deleteArticle(articleId);
    });
  }

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border-subtle px-6 py-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <Link href="/kb" className="text-[0.8125rem] text-secondary hover:text-primary">
          ← Knowledge base
        </Link>
        <Badge tone={status === "published" ? "success" : "neutral"}>
          {status === "published" ? "Published" : "Draft"}
        </Badge>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {status === "published" && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.8125rem] text-secondary hover:text-primary"
          >
            View live
          </a>
        )}
        <Button variant="secondary" size="sm" disabled={pending} onClick={handleToggle}>
          {status === "published" ? "Unpublish" : "Publish"}
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={handleDelete}>
          Delete
        </Button>
      </div>
    </header>
  );
}
