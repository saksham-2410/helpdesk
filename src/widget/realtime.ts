import { RealtimeClient, type RealtimeChannel } from "@supabase/realtime-js";
import type { WidgetMessage } from "./format";

/**
 * The widget's own connection to its conversation's broadcast topic.
 *
 * Imports `@supabase/realtime-js` directly rather than the full `supabase-js`
 * client: `createClient()` always instantiates Postgrest/Auth/Storage
 * sub-clients regardless of whether they're used, and the widget needs none
 * of them — only channels, broadcast, and presence. Meaningfully smaller
 * bundle for a script that's supposed to be a single lightweight tag on
 * someone else's site.
 *
 * See lib/widget/realtime.ts for why this rides an unauthenticated,
 * unguessable-topic broadcast channel rather than Realtime's JWT-gated
 * `private` channels — the trade-off is documented there and in the README.
 */

interface PresenceMeta {
  role: "visitor" | "agent";
  online_at: string;
}

export interface ConnectionHandlers {
  onMessage(message: WidgetMessage): void;
  onTyping(typing: boolean): void;
  onRead(at: string): void;
  onAgentPresence(online: boolean): void;
  /** Fires on every (re)subscribe, including the first — the caller uses this
   *  as the signal to backfill from its last known message timestamp. */
  onSubscribed(): void;
  onConnectionStateChange(state: "connecting" | "connected" | "disconnected"): void;
}

export interface ConversationConnection {
  sendTyping(typing: boolean): void;
  sendRead(): void;
  disconnect(): void;
}

export function connectConversationChannel(
  supabaseUrl: string,
  supabaseAnonKey: string,
  conversationId: string,
  visitorId: string,
  handlers: ConnectionHandlers,
): ConversationConnection {
  // realtime-js wants the websocket endpoint, not the REST base.
  const wsUrl = `${supabaseUrl.replace(/^http/, "ws")}/realtime/v1`;

  const client = new RealtimeClient(wsUrl, {
    params: { apikey: supabaseAnonKey, eventsPerSecond: 10 },
  });

  const topic = `conv:${conversationId}`;
  const channel: RealtimeChannel = client.channel(topic, {
    config: {
      broadcast: { self: true },
      presence: { key: visitorId },
    },
  });

  channel
    .on("broadcast", { event: "message" }, ({ payload }) => {
      handlers.onMessage(payload as WidgetMessage);
    })
    .on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { from: "visitor" | "agent"; typing: boolean };
      if (p.from === "agent") handlers.onTyping(p.typing);
    })
    .on("broadcast", { event: "read" }, ({ payload }) => {
      const p = payload as { by: "visitor" | "agent"; at: string };
      if (p.by === "agent") handlers.onRead(p.at);
    })
    .on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const online = Object.values(state)
        .flat()
        .some((p) => p.role === "agent");
      handlers.onAgentPresence(online);
    });

  handlers.onConnectionStateChange("connecting");

  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") {
      handlers.onConnectionStateChange("connected");
      await channel.track({ role: "visitor", online_at: new Date().toISOString() } satisfies PresenceMeta);
      // Fires on the initial connect AND every automatic reconnect —
      // realtime-js resubscribes existing channels after a socket drop and
      // re-invokes this callback, which is exactly the signal a reconnect
      // handler needs to trigger a backfill.
      handlers.onSubscribed();
    } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      handlers.onConnectionStateChange("disconnected");
    }
  });

  return {
    sendTyping(typing) {
      channel.send({ type: "broadcast", event: "typing", payload: { from: "visitor", typing } });
    },
    sendRead() {
      channel.send({
        type: "broadcast",
        event: "read",
        payload: { by: "visitor", at: new Date().toISOString() },
      });
    },
    disconnect() {
      client.removeChannel(channel);
    },
  };
}
