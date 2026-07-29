"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/field";
import type { KbSearchResult } from "@/lib/kb/types";

/** Same debounced-suggest endpoint the widget uses (/api/widget/kb/suggest) —
 *  one search implementation for both surfaces rather than two. */
export function HelpSearch({ workspaceSlug }: { workspaceSlug: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KbSearchResult[]>([]);
  const [focused, setFocused] = useState(false);

  // Clearing on a too-short query happens in the change handler, not the
  // effect below — an effect body must not call setState synchronously
  // (react-hooks/set-state-in-effect); the effect only ever sets state from
  // inside its async debounce callback, which is the external-system case
  // that rule allows.
  function handleChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) setResults([]);
  }

  useEffect(() => {
    if (query.trim().length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/widget/kb/suggest?workspace=${encodeURIComponent(workspaceSlug)}&q=${encodeURIComponent(query)}`,
        );
        const data = await res.json();
        setResults(data.articles ?? []);
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, workspaceSlug]);

  const open = focused && results.length > 0;

  return (
    <div className="relative text-left">
      <Input
        type="search"
        placeholder="Search articles…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        className="h-11 rounded-full bg-canvas px-4 text-center placeholder:text-center"
      />
      {open && (
        <ul className="absolute inset-x-0 top-full z-10 mt-2 overflow-hidden rounded-lg border border-border-default bg-surface-raised text-left shadow-mid">
          {results.map((r) => (
            <li key={r.id}>
              <Link
                href={`/help/${workspaceSlug}/${r.slug}`}
                className="block px-4 py-2.5 text-sm hover:bg-surface-emphasis"
              >
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
