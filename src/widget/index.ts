import { WIDGET_CSS } from "./styles";
import { createWidgetApi, WidgetApiError } from "./api";
import { connectConversationChannel, type ConversationConnection } from "./realtime";
import {
  mergeMessages,
  reconcileOptimistic,
  latestTimestamp,
  formatTime,
  escapeHtml,
  type WidgetMessage,
} from "./format";

/**
 * Widget entry point. Bundled by scripts/build-widget.mjs into a single
 * dependency-free IIFE at public/widget.js — no React, no framework runtime
 * shipped to a third-party page, matching "any website installs with a
 * single script tag."
 *
 * Everything mounts inside one Shadow DOM root: the host page's CSS cannot
 * reach in, and this widget's CSS cannot leak out. See styles.ts for why the
 * stylesheet is fully self-contained rather than inheriting design tokens.
 */

// esbuild `define` replaces these at build time — see scripts/build-widget.mjs.
declare const __HD_API_BASE__: string;
declare const __HD_SUPABASE_URL__: string;
declare const __HD_SUPABASE_ANON_KEY__: string;

const HOST_ELEMENT_ID = "hd-widget-host";
const TYPING_STOP_DELAY_MS = 2000;

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for older browsers a customer's visitor might still be on.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

interface State {
  status: "idle" | "loading" | "ready" | "error";
  open: boolean;
  messages: WidgetMessage[];
  typing: boolean;
  agentOnline: boolean;
  connection: "connecting" | "connected" | "disconnected";
  lastReadByAgentAt: string | null;
  errorMessage: string | null;
  workspace: { name: string; greeting: string; accentColor: string | null } | null;
  token: string | null;
  conversationId: string | null;
}

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

const ICON_CHAT = icon(
  '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
);
const ICON_CLOSE = icon('<path d="M18 6 6 18M6 6l12 12"/>');
const ICON_SEND = icon('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>');

function initWidget(scriptEl: HTMLOrSVGScriptElement | null) {
  if (document.getElementById(HOST_ELEMENT_ID)) return; // already mounted

  const workspaceSlug = scriptEl?.getAttribute?.("data-workspace");
  if (!workspaceSlug) {
    console.error("[Helpdesk widget] missing data-workspace attribute on the script tag.");
    return;
  }

  const storageKey = `hd_visitor_id:${workspaceSlug}`;
  let visitorId: string;
  try {
    visitorId = localStorage.getItem(storageKey) ?? generateId();
    localStorage.setItem(storageKey, visitorId);
  } catch {
    // Private browsing / storage disabled: fall back to a session-only id
    // rather than failing to mount. History just won't persist across visits.
    visitorId = generateId();
  }

  const api = createWidgetApi(__HD_API_BASE__, workspaceSlug);

  const host = document.createElement("div");
  host.id = HOST_ELEMENT_ID;
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  const styleEl = document.createElement("style");
  styleEl.textContent = WIDGET_CSS;
  shadow.appendChild(styleEl);

  const root = document.createElement("div");
  root.innerHTML = `
    <button class="bubble" type="button" aria-label="Open chat" data-open="false">
      <span class="icon-chat">${ICON_CHAT}</span>
      <span class="icon-close">${ICON_CLOSE}</span>
    </button>
    <div class="panel" data-open="false" role="dialog" aria-label="Chat">
      <div class="header">
        <div class="title">Chat with us</div>
        <div class="status" data-online="false"><span class="dot"></span><span class="status-text">Connecting…</span></div>
      </div>
      <div class="body"></div>
      <div class="kb-suggestions" hidden></div>
      <div class="composer">
        <textarea rows="1" placeholder="Write a message…" maxlength="4000"></textarea>
        <button type="button" aria-label="Send">${ICON_SEND}</button>
      </div>
    </div>
  `;
  shadow.appendChild(root);

  const bubbleEl = root.querySelector<HTMLButtonElement>(".bubble")!;
  const panelEl = root.querySelector<HTMLDivElement>(".panel")!;
  const bodyEl = root.querySelector<HTMLDivElement>(".body")!;
  const statusEl = root.querySelector<HTMLDivElement>(".status")!;
  const statusTextEl = root.querySelector<HTMLSpanElement>(".status-text")!;
  const textareaEl = root.querySelector<HTMLTextAreaElement>("textarea")!;
  const sendBtnEl = root.querySelector<HTMLButtonElement>(".composer button")!;
  const suggestionsEl = root.querySelector<HTMLDivElement>(".kb-suggestions")!;

  const state: State = {
    status: "idle",
    open: false,
    messages: [],
    typing: false,
    agentOnline: false,
    connection: "connecting",
    lastReadByAgentAt: null,
    errorMessage: null,
    workspace: null,
    token: null,
    conversationId: null,
  };

  let connection: ConversationConnection | null = null;
  let typingLocal = false;
  let typingStopTimer: ReturnType<typeof setTimeout> | null = null;
  let suggestTimer: ReturnType<typeof setTimeout> | null = null;
  let suggestSeq = 0;

  function renderSuggestions(articles: { title: string; slug: string }[]) {
    if (articles.length === 0) {
      suggestionsEl.hidden = true;
      suggestionsEl.innerHTML = "";
      return;
    }
    suggestionsEl.hidden = false;
    suggestionsEl.innerHTML =
      `<div class="kb-suggestions-label">Might help</div>` +
      articles
        .map(
          (a) =>
            `<a class="kb-suggestion" href="${__HD_API_BASE__}/help/${encodeURIComponent(workspaceSlug!)}/${encodeURIComponent(a.slug)}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a>`,
        )
        .join("");
  }

  function clearSuggestions() {
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = null;
    renderSuggestions([]);
  }

  function renderStatus() {
    statusEl.dataset.online = String(state.agentOnline);
    statusTextEl.textContent =
      state.connection === "disconnected"
        ? "Reconnecting…"
        : state.agentOnline
          ? "Online"
          : "We'll reply as soon as we can";
  }

  function scrollToBottom() {
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function renderBody() {
    if (state.status === "loading" || state.status === "idle") {
      bodyEl.innerHTML = `<div class="state-message"><div class="spinner"></div>Connecting…</div>`;
      return;
    }
    if (state.status === "error") {
      bodyEl.innerHTML = `<div class="state-message">${escapeHtml(state.errorMessage ?? "Something went wrong.")}</div>`;
      return;
    }

    const wasNearBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 48;

    const greeting = state.messages.length === 0 && state.workspace
      ? `<div class="greeting">${escapeHtml(state.workspace.greeting)}</div>`
      : "";

    const rows = state.messages
      .map((m) => {
        const seen =
          m.authorType === "contact" &&
          state.lastReadByAgentAt &&
          m.createdAt <= state.lastReadByAgentAt &&
          m === state.messages.filter((x) => x.authorType === "contact").at(-1);
        return `
          <div>
            <div class="row" data-author="${m.authorType}">
              <div class="bubble-msg">${escapeHtml(m.bodyText)}</div>
            </div>
            <div class="meta" style="text-align:${m.authorType === "contact" ? "right" : "left"}">
              ${formatTime(m.createdAt)}${m.pending ? " · Sending…" : seen ? " · Seen" : ""}
            </div>
          </div>`;
      })
      .join("");

    const typingRow = state.typing
      ? `<div class="typing-row"><div class="typing-dots"><span></span><span></span><span></span></div></div>`
      : "";

    bodyEl.innerHTML = greeting + rows + typingRow;
    if (wasNearBottom || state.typing) scrollToBottom();
  }

  function render() {
    bubbleEl.dataset.open = String(state.open);
    panelEl.dataset.open = String(state.open);
    if (state.workspace) {
      root.querySelector(".title")!.textContent = state.workspace.name
        ? `Chat with ${state.workspace.name}`
        : "Chat with us";
    }
    renderStatus();
    renderBody();
  }

  function applyAccentColor(color: string | null) {
    if (color) host.style.setProperty("--hd-accent-override", color);
  }

  async function bootstrap() {
    state.status = "loading";
    render();
    try {
      const session = await api.startSession(visitorId);
      state.token = session.token;
      state.conversationId = session.conversationId;
      state.workspace = session.workspace;
      state.messages = mergeMessages([], session.messages);
      state.status = "ready";
      applyAccentColor(session.workspace.accentColor);
      render();

      connection = connectConversationChannel(
        __HD_SUPABASE_URL__,
        __HD_SUPABASE_ANON_KEY__,
        session.conversationId,
        visitorId,
        {
          onMessage(message) {
            state.messages = mergeMessages(state.messages, [message]);
            render();
            if (state.open && message.authorType === "agent") connection?.sendRead();
          },
          onTyping(typing) {
            state.typing = typing;
            render();
          },
          onRead(at) {
            state.lastReadByAgentAt = at;
            render();
          },
          onAgentPresence(online) {
            state.agentOnline = online;
            renderStatus();
          },
          onConnectionStateChange(connState) {
            state.connection = connState;
            renderStatus();
          },
          async onSubscribed() {
            if (!state.token) return;
            try {
              const fresh = await api.fetchMessages(state.token, latestTimestamp(state.messages));
              if (fresh.length > 0) {
                state.messages = mergeMessages(state.messages, fresh);
                render();
              }
            } catch {
              // A failed backfill is not fatal — the socket is still live and
              // will deliver new messages; the gap (if any) closes on the
              // next successful reconnect.
            }
          },
        },
      );

      if (state.open) connection.sendRead();
    } catch (err) {
      state.status = "error";
      state.errorMessage =
        err instanceof WidgetApiError ? err.message : "Could not connect. Please try again.";
      render();
    }
  }

  function setOpen(open: boolean) {
    state.open = open;
    render();
    if (open) {
      if (state.status === "idle") void bootstrap();
      else connection?.sendRead();
      setTimeout(() => textareaEl.focus(), 50);
    }
  }

  bubbleEl.addEventListener("click", () => setOpen(!state.open));

  function stopTypingSignal() {
    if (typingStopTimer) clearTimeout(typingStopTimer);
    typingStopTimer = null;
    if (typingLocal) {
      typingLocal = false;
      connection?.sendTyping(false);
    }
  }

  textareaEl.addEventListener("input", () => {
    textareaEl.style.height = "auto";
    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 96)}px`;

    if (!typingLocal) {
      typingLocal = true;
      connection?.sendTyping(true);
    }
    if (typingStopTimer) clearTimeout(typingStopTimer);
    typingStopTimer = setTimeout(stopTypingSignal, TYPING_STOP_DELAY_MS);

    const query = textareaEl.value.trim();
    if (suggestTimer) clearTimeout(suggestTimer);
    if (query.length < 4) {
      renderSuggestions([]);
      return;
    }
    const seq = ++suggestSeq;
    suggestTimer = setTimeout(async () => {
      try {
        const articles = await api.suggestArticles(query);
        // A slower, stale request can resolve after a newer one — only the
        // latest debounced call is allowed to paint.
        if (seq === suggestSeq) renderSuggestions(articles);
      } catch {
        if (seq === suggestSeq) renderSuggestions([]);
      }
    }, 350);
  });

  async function send() {
    const text = textareaEl.value.trim();
    if (!text || !state.token || state.status !== "ready") return;

    stopTypingSignal();
    clearSuggestions();
    textareaEl.value = "";
    textareaEl.style.height = "auto";

    const tempId = `temp-${generateId()}`;
    state.messages = mergeMessages(state.messages, [
      { id: tempId, authorType: "contact", bodyText: text, createdAt: new Date().toISOString(), pending: true },
    ]);
    render();

    try {
      const confirmed = await api.sendMessage(state.token, text);
      state.messages = reconcileOptimistic(state.messages, tempId, confirmed);
      render();
    } catch {
      state.messages = state.messages.filter((m) => m.id !== tempId);
      state.errorMessage = null; // keep the transcript visible; don't switch to the full error state
      render();
      bodyEl.insertAdjacentHTML(
        "beforeend",
        `<div class="state-message" style="padding:8px;">Message failed to send.</div>`,
      );
      scrollToBottom();
    }
  }

  sendBtnEl.addEventListener("click", () => void send());
  textareaEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.open) connection?.sendRead();
  });

  render();

  // Minimal programmatic API for host pages ("Contact us" links elsewhere on
  // the page) — a small, expected completeness touch for an embeddable widget.
  (window as unknown as { HelpdeskWidget?: unknown }).HelpdeskWidget = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!state.open),
  };
}

// Must run synchronously at the top of this script's own execution —
// document.currentScript is correctly scoped to classic scripts (including
// deferred ones) only while they are actively executing; capturing it inside
// a later callback would find nothing.
const thisScript = (document.currentScript as HTMLOrSVGScriptElement | null)
  ?? document.querySelector<HTMLOrSVGScriptElement>("script[data-workspace]");

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initWidget(thisScript));
} else {
  initWidget(thisScript);
}
