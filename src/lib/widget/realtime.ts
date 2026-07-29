import "server-only";
import { env } from "@/lib/env";

/**
 * Server-side Realtime broadcast.
 *
 * The agent dashboard gets live updates "for free" via Supabase's
 * `postgres_changes` — an authenticated session subject to RLS naturally only
 * sees its own workspace's rows. The widget cannot use that path: it is
 * anonymous, and RLS correctly grants anon **no** read access to `messages`
 * (that is the point of RLS — the alternative is a public read hole).
 *
 * So the widget's live updates ride a separate, explicit channel: a broadcast
 * topic named after the conversation's UUID. Nothing is subscribed to it by
 * default; knowing the UUID is what grants access, the same trust model as a
 * Stripe payment link or a Figma share link. This is the documented trade-off
 * from the design doc — the stronger alternative (Realtime's JWT-gated
 * `private` channels via `realtime.authorization` policies) was judged not
 * worth the implementation risk in a 48-hour build, and is called out in the
 * README as the natural next step.
 *
 * Publishing uses Realtime's REST broadcast endpoint rather than opening a
 * WebSocket per request: a serverless function that opens a socket just to
 * send one message and hang up is the wrong tool, and the REST endpoint is
 * built for exactly this (fire-and-forget publish from a backend).
 */

export function conversationTopic(conversationId: string): string {
  return `conv:${conversationId}`;
}

export type BroadcastEvent =
  | { event: "message"; payload: WidgetMessagePayload }
  | { event: "typing"; payload: { from: "visitor" | "agent"; typing: boolean } }
  | { event: "read"; payload: { by: "visitor" | "agent"; at: string } };

export interface WidgetMessagePayload {
  id: string;
  conversationId: string;
  authorType: "contact" | "agent" | "system";
  bodyText: string;
  createdAt: string;
}

/**
 * Publish one broadcast event to a conversation's topic. Best-effort: a
 * dropped realtime event is recoverable (the widget backfills on reconnect
 * via GET /api/widget/messages), so a broadcast failure is logged and
 * swallowed rather than failing the request that triggered it — the message
 * is already durably written to Postgres by the time this runs.
 */
export async function broadcast(
  conversationId: string,
  event: BroadcastEvent,
): Promise<void> {
  const url = `${env.supabaseUrl}/realtime/v1/api/broadcast`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.supabaseServiceKey,
        authorization: `Bearer ${env.supabaseServiceKey}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: conversationTopic(conversationId),
            event: event.event,
            payload: event.payload,
            private: false,
          },
        ],
      }),
    });

    if (!res.ok) {
      console.error(
        `[realtime] broadcast failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
  } catch (err) {
    console.error("[realtime] broadcast threw", err);
  }
}
