"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";

/** A code block with a copy button — used for the widget install snippet
 *  wherever it's shown (the demo page, Settings). */
export function CopyCode({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API can be denied by permissions policy; the code is still
      // visible and selectable, so this fails quietly rather than alerting.
    }
  }

  return (
    <div className={cn("relative", className)}>
      <pre className="overflow-x-auto rounded-lg border border-border-default bg-paper-900 p-4 text-[0.8125rem] leading-relaxed text-paper-100 dark:bg-paper-950">
        <code className="font-mono">{code}</code>
      </pre>
      <button
        type="button"
        onClick={handleCopy}
        className="absolute right-2.5 top-2.5 rounded-sm border border-paper-700 bg-paper-800 px-2 py-1 text-[0.6875rem] font-medium text-paper-100 transition-colors hover:bg-paper-700"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
