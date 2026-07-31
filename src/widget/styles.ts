/**
 * Self-contained widget styles.
 *
 * The dashboard's `globals.css` sets `@theme static` specifically so
 * `var(--color-*)` resolves even where Tailwind's generated utilities don't
 * reach — but that only helps on OUR OWN pages, where globals.css is loaded
 * and its custom properties inherit down through the shadow boundary (custom
 * properties, unlike style rules, do cross into a shadow tree via normal CSS
 * inheritance).
 *
 * A widget installed on a stranger's site has no such ancestor: there is no
 * globals.css there for anything to inherit from. So this stylesheet is
 * fully self-contained — its own `--hd-*` tokens declared on `:host`, a
 * curated subset of the Field Notes palette translated into a component the
 * host page never has to know exists. This is what makes "install with one
 * script tag on any website" actually true rather than true-only-on-our-own-
 * demo-page.
 *
 * `--hd-accent` accepts an override so a workspace's branding.accentColor
 * (from `workspaces.settings`) can be applied by setting an inline style on
 * the host element — see index.ts.
 */
export const WIDGET_CSS = /* css */ `
  :host {
    --hd-paper-50: #fdfcfa;
    --hd-paper-100: #f8f6f2;
    --hd-paper-200: #efece5;
    --hd-paper-300: #e2ddd3;
    --hd-paper-500: #9c9486;
    --hd-paper-700: #524c43;
    --hd-paper-900: #1f1c18;

    --hd-petrol-50: #eef6f5;
    --hd-petrol-500: #1e7370;
    --hd-petrol-600: #175d5b;

    --hd-signal-500: #d95323;

    --hd-accent: var(--hd-accent-override, var(--hd-petrol-500));
    --hd-accent-hover: var(--hd-petrol-600);

    --hd-radius-md: 0.4375rem;
    --hd-radius-lg: 0.625rem;
    --hd-radius-2xl: 1.25rem;

    --hd-shadow-widget: 0 12px 40px rgb(31 28 24 / 0.16), 0 4px 12px rgb(31 28 24 / 0.10);
    --hd-shadow-bubble: 0 6px 20px rgb(31 28 24 / 0.22);

    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    color-scheme: light;
  }

  * { box-sizing: border-box; }

  /* The UA stylesheet's [hidden] { display: none } loses to any of this
     file's own display rules at equal specificity (author origin beats UA
     origin, but only when there's no competing author rule) — .composer,
     .body, .kb-suggestions, and .prechat all set their own display, so
     toggling the hidden attribute alone silently does nothing without this. */
  [hidden] { display: none !important; }

  .bubble {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 56px;
    height: 56px;
    border-radius: 999px;
    background: var(--hd-accent);
    color: white;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--hd-shadow-bubble);
    transition: transform 0.15s ease, background-color 0.15s ease;
    z-index: 2147483000;
  }
  .bubble:hover { background: var(--hd-accent-hover); transform: scale(1.05); }
  .bubble:active { transform: scale(0.97); }
  .bubble svg { width: 24px; height: 24px; transition: opacity 0.12s, transform 0.12s; }
  .bubble .icon-close { position: absolute; opacity: 0; transform: rotate(-90deg) scale(0.7); }
  .bubble[data-open="true"] .icon-chat { opacity: 0; transform: rotate(90deg) scale(0.7); }
  .bubble[data-open="true"] .icon-close { opacity: 1; transform: none; }

  .panel {
    position: fixed;
    right: 20px;
    bottom: 88px;
    width: 368px;
    max-width: calc(100vw - 40px);
    height: 560px;
    max-height: calc(100vh - 120px);
    background: var(--hd-paper-50);
    border-radius: var(--hd-radius-2xl);
    box-shadow: var(--hd-shadow-widget);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    opacity: 0;
    transform: translateY(12px) scale(0.98);
    pointer-events: none;
    transition: opacity 0.18s cubic-bezier(0.22,1,0.36,1), transform 0.18s cubic-bezier(0.22,1,0.36,1);
    z-index: 2147483000;
  }
  .panel[data-open="true"] {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }

  .header {
    padding: 16px 18px;
    background: var(--hd-accent);
    color: white;
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex-shrink: 0;
  }
  .header .title { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
  .header .status {
    font-size: 12px;
    opacity: 0.85;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .header .status .dot {
    width: 6px; height: 6px; border-radius: 999px;
    background: currentColor;
    opacity: 0.5;
  }
  .header .status[data-online="true"] .dot { background: #6fd6a8; opacity: 1; }

  .prechat {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px;
    background: var(--hd-paper-100);
    overflow-y: auto;
  }
  .prechat-intro {
    font-size: 13px;
    color: var(--hd-paper-700);
    line-height: 1.5;
    margin: 0 0 4px;
  }
  .prechat-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 12px;
    font-weight: 600;
    color: var(--hd-paper-700);
  }
  .prechat-field em {
    font-weight: 400;
    font-style: normal;
    color: var(--hd-paper-500);
  }
  .prechat-field input {
    border: 1px solid var(--hd-paper-200);
    border-radius: var(--hd-radius-md);
    padding: 9px 10px;
    font: inherit;
    font-size: 13.5px;
    color: var(--hd-paper-900);
    background: white;
  }
  .prechat-field input:focus {
    outline: none;
    border-color: var(--hd-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--hd-accent) 18%, transparent);
  }
  .prechat-error {
    font-size: 12px;
    color: var(--hd-signal-500);
    margin: -6px 0 0;
  }
  .prechat button[type="submit"] {
    margin-top: 4px;
    padding: 10px;
    border: none;
    border-radius: var(--hd-radius-md);
    background: var(--hd-accent);
    color: white;
    font: inherit;
    font-size: 13.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .prechat button[type="submit"]:hover { background: var(--hd-accent-hover); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--hd-paper-100);
  }
  .body::-webkit-scrollbar { width: 8px; }
  .body::-webkit-scrollbar-thumb { background: var(--hd-paper-300); border-radius: 999px; }

  .greeting {
    font-size: 13px;
    color: var(--hd-paper-700);
    background: var(--hd-paper-50);
    border: 1px solid var(--hd-paper-200);
    border-radius: var(--hd-radius-lg);
    padding: 12px 14px;
    line-height: 1.5;
  }

  .row { display: flex; }
  .row[data-author="contact"] { justify-content: flex-end; }
  .row[data-author="agent"], .row[data-author="system"] { justify-content: flex-start; }

  .bubble-msg {
    max-width: 82%;
    padding: 8px 12px;
    border-radius: var(--hd-radius-lg);
    font-size: 13.5px;
    line-height: 1.45;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .row[data-author="contact"] .bubble-msg {
    background: var(--hd-accent);
    color: white;
    border-bottom-right-radius: 3px;
  }
  .row[data-author="agent"] .bubble-msg {
    background: var(--hd-paper-50);
    color: var(--hd-paper-900);
    border: 1px solid var(--hd-paper-200);
    border-bottom-left-radius: 3px;
  }
  .row[data-author="system"] .bubble-msg {
    background: transparent;
    color: var(--hd-paper-500);
    font-size: 11.5px;
    text-align: center;
    margin: 0 auto;
  }

  .meta {
    font-size: 10.5px;
    color: var(--hd-paper-500);
    margin-top: 3px;
  }
  .row[data-author="contact"] + .meta-row { text-align: right; }

  .typing-row { display: flex; justify-content: flex-start; padding-left: 2px; }
  .typing-dots {
    display: flex;
    gap: 3px;
    padding: 9px 12px;
    background: var(--hd-paper-50);
    border: 1px solid var(--hd-paper-200);
    border-radius: var(--hd-radius-lg);
    border-bottom-left-radius: 3px;
  }
  .typing-dots span {
    width: 5px; height: 5px; border-radius: 999px;
    background: var(--hd-paper-500);
    animation: hd-typing-bounce 1.1s infinite ease-in-out;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.12s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.24s; }
  @keyframes hd-typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
    30% { transform: translateY(-3px); opacity: 1; }
  }

  .kb-suggestions {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border-top: 1px solid var(--hd-paper-200);
    background: var(--hd-paper-100);
    flex-shrink: 0;
  }
  .kb-suggestions-label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--hd-paper-500);
    padding: 0 2px 2px;
  }
  .kb-suggestion {
    display: block;
    padding: 7px 9px;
    border-radius: var(--hd-radius-md);
    background: var(--hd-paper-50);
    border: 1px solid var(--hd-paper-200);
    color: var(--hd-petrol-600);
    font-size: 12.5px;
    font-weight: 500;
    text-decoration: none;
    line-height: 1.3;
  }
  .kb-suggestion:hover { background: white; border-color: var(--hd-accent); }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px;
    border-top: 1px solid var(--hd-paper-200);
    background: var(--hd-paper-50);
    flex-shrink: 0;
  }
  .composer textarea {
    flex: 1;
    resize: none;
    border: 1px solid var(--hd-paper-200);
    border-radius: var(--hd-radius-md);
    padding: 8px 10px;
    font: inherit;
    font-size: 13.5px;
    line-height: 1.4;
    max-height: 96px;
    color: var(--hd-paper-900);
    background: white;
  }
  .composer textarea:focus {
    outline: none;
    border-color: var(--hd-accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--hd-accent) 18%, transparent);
  }
  .composer button {
    width: 34px; height: 34px;
    border-radius: var(--hd-radius-md);
    border: none;
    background: var(--hd-accent);
    color: white;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s, opacity 0.15s;
  }
  .composer button:hover { background: var(--hd-accent-hover); }
  .composer button:disabled { opacity: 0.4; cursor: default; }
  .composer button svg { width: 16px; height: 16px; }

  .state-message {
    margin: auto;
    text-align: center;
    font-size: 13px;
    color: var(--hd-paper-500);
    padding: 24px;
  }

  .spinner {
    width: 18px; height: 18px;
    border-radius: 999px;
    border: 2px solid var(--hd-paper-300);
    border-top-color: var(--hd-accent);
    animation: hd-spin 0.7s linear infinite;
    margin: 0 auto 10px;
  }
  @keyframes hd-spin { to { transform: rotate(360deg); } }

  @media (max-width: 420px) {
    .panel {
      right: 12px; left: 12px; bottom: 84px;
      width: auto; max-width: none;
    }
    .bubble { right: 16px; bottom: 16px; }
  }
`;
