import type { WidgetMessage } from "./format";

/**
 * Thin fetch wrappers for the widget's own backend. `apiBase` is the app's
 * own absolute origin (baked in at bundle build time via esbuild `define`) —
 * NOT the origin of whatever third-party page the widget is embedded on, so
 * every call here is necessarily cross-origin from the host page's point of
 * view. See lib/widget/cors.ts on the server side.
 */

export interface SessionResponse {
  token: string;
  conversationId: string;
  workspace: { name: string; slug: string; greeting: string; accentColor: string | null };
  messages: WidgetMessage[];
}

export interface KbSuggestion {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
}

export class WidgetApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "WidgetApiError";
  }
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new WidgetApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export function createWidgetApi(apiBase: string, workspaceSlug: string) {
  return {
    async startSession(visitorId: string, name?: string, email?: string): Promise<SessionResponse> {
      const res = await fetch(`${apiBase}/api/widget/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceSlug,
          visitorId,
          ...(name ? { name } : {}),
          ...(email ? { email } : {}),
        }),
      });
      return parseOrThrow<SessionResponse>(res);
    },

    async sendMessage(token: string, body: string): Promise<WidgetMessage> {
      const res = await fetch(`${apiBase}/api/widget/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ body }),
      });
      return parseOrThrow<WidgetMessage>(res);
    },

    async fetchMessages(token: string, after?: string | null): Promise<WidgetMessage[]> {
      const url = new URL(`${apiBase}/api/widget/messages`);
      if (after) url.searchParams.set("after", after);
      const res = await fetch(url.toString(), {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await parseOrThrow<{ messages: WidgetMessage[] }>(res);
      return data.messages;
    },

    async suggestArticles(query: string): Promise<KbSuggestion[]> {
      const url = new URL(`${apiBase}/api/widget/kb/suggest`);
      url.searchParams.set("workspace", workspaceSlug);
      url.searchParams.set("q", query);
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const data = (await res.json()) as { articles?: KbSuggestion[] };
      return data.articles ?? [];
    },
  };
}

export type WidgetApi = ReturnType<typeof createWidgetApi>;
