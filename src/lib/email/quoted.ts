/**
 * Trimming quoted history off email replies.
 *
 * A two-line reply arrives carrying the entire thread quoted underneath it.
 * Storing that verbatim has three costs: the inbox becomes unreadable, the
 * conversation grows quadratically as each reply re-quotes the last, and the
 * AI summarizer pays for the same text over and over.
 *
 * There is no standard for this — every client marks quotes differently — so
 * this is unavoidably a set of heuristics. It is written to fail safe: if no
 * marker is recognised, the original text is returned unchanged. Losing a
 * reply is far worse than showing one that is too long.
 */

/** Text markers that begin quoted history. First match wins. */
const TEXT_MARKERS: RegExp[] = [
  // "On Tue, 3 Jun 2026 at 14:02, Alice <a@x.com> wrote:"
  /^\s*On\s.{6,200}\swrote:\s*$/im,
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  // Outlook's block header
  /^\s*From:\s.+$/im,
  /^\s*_{10,}\s*$/m,
  // "Sent from my iPhone" style signatures immediately preceding a quote
  /^\s*Le\s.{6,200}\sa écrit\s*:\s*$/im,
  /^\s*Am\s.{6,200}\sschrieb\s.+:\s*$/im,
];

/** HTML containers clients wrap quoted history in. */
const HTML_QUOTE_SELECTORS = [
  "gmail_quote",
  "gmail_quote_container",
  "yahoo_quoted",
  "moz-cite-prefix",
  "OutlookMessageHeader",
];

/**
 * Trim quoted history from a plain-text body.
 * Returns the original string when nothing is recognised.
 */
export function stripQuotedText(body: string): string {
  if (!body) return "";

  let cutAt = body.length;

  for (const marker of TEXT_MARKERS) {
    const match = marker.exec(body);
    if (match?.index != null && match.index < cutAt) {
      cutAt = match.index;
    }
  }

  // A run of ">" quoted lines also marks the boundary, but only when it is not
  // the very beginning — some people top-quote and write underneath.
  const quotedBlock = /(?:^>.*\n){2,}/m.exec(body);
  if (quotedBlock?.index != null && quotedBlock.index > 0 && quotedBlock.index < cutAt) {
    cutAt = quotedBlock.index;
  }

  const trimmed = body.slice(0, cutAt).trimEnd();

  // Fail safe: if trimming leaves essentially nothing, the markers probably
  // matched something that was not a quote. Prefer too much over nothing.
  return trimmed.trim().length === 0 ? body.trim() : trimmed;
}

/**
 * Trim quoted history from an HTML body.
 *
 * Regex-based rather than DOM-based on purpose: this runs in a webhook handler
 * on untrusted input, and the output is sanitised downstream regardless. It
 * removes whole known-quote containers and everything after them.
 */
export function stripQuotedHtml(html: string): string {
  if (!html) return "";

  let cutAt = html.length;

  for (const cls of HTML_QUOTE_SELECTORS) {
    const idx = html.search(new RegExp(`<[^>]+(?:class|id)=["'][^"']*${cls}`, "i"));
    if (idx !== -1 && idx < cutAt) cutAt = idx;
  }

  // Apple Mail and several others separate the reply with a bare <blockquote>.
  const blockquote = html.search(/<blockquote[\s>]/i);
  if (blockquote !== -1 && blockquote < cutAt) cutAt = blockquote;

  // Outlook's divider.
  const divider = html.search(/<div[^>]+id=["']?(?:divRplyFwdMsg|appendonsend)/i);
  if (divider !== -1 && divider < cutAt) cutAt = divider;

  const trimmed = html.slice(0, cutAt);
  return stripTags(trimmed).trim().length === 0 ? html : trimmed;
}

/** Crude tag strip, used only to test whether a fragment has visible text. */
function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ");
}

/**
 * Plain-text projection of an email body, for search and for the AI prompt.
 * Prefers the text/plain part; falls back to flattening the HTML.
 */
export function toPlainText(args: { text?: string | null; html?: string | null }): string {
  if (args.text && args.text.trim()) return args.text.trim();
  if (!args.html) return "";

  return stripTags(
    args.html
      // Preserve block structure as newlines before dropping tags, otherwise
      // paragraphs run together into one unreadable line.
      .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n"),
  )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    // Tag removal substitutes a space for each tag, which leaves stray
    // indentation hanging off every newline ("one\n two"). Collapse it, or
    // that whitespace ends up in the search index and the AI prompt.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
