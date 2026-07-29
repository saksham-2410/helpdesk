import sanitizeHtml from "sanitize-html";

/**
 * Article bodies are author-controlled (workspace agents/admins, not
 * customers), but they're still rendered on a public page anonymous visitors
 * load with no auth — so stored HTML is sanitized at render, never trusted
 * as-is, the same posture as inbound email bodies. Allowlist matches exactly
 * what the Tiptap StarterKit + Link extension can produce; nothing else is a
 * legitimate output of the editor.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p", "br", "hr",
    "strong", "em", "s", "code",
    "h1", "h2", "h3",
    "ul", "ol", "li",
    "blockquote", "pre",
    "a",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

export function sanitizeArticleHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
