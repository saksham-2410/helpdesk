import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import { verifyVisitorToken, bearerToken } from "@/lib/widget/token";
import { broadcast } from "@/lib/widget/realtime";
import { widgetJson, widgetPreflight } from "@/lib/widget/cors";
import { rateLimit, clientKey } from "@/lib/rate-limit";

/**
 * GET/POST /api/widget/messages
 *
 * Both handlers trust ONLY the workspaceId/contactId/conversationId embedded
 * in the verified visitor token — never an id from the query string or body.
 * The token was minted server-side for exactly one conversation; accepting a
 * client-supplied conversationId instead would let any visitor read or post
 * into any conversation by guessing (or enumerating) a UUID.
 */

export async function OPTIONS(request: Request) {
  return widgetPreflight(request);
}

async function authenticate(request: Request) {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return { error: widgetJson(request, { error: "Missing token." }, { status: 401 }) };

  const result = await verifyVisitorToken(token);
  if (!result.ok) {
    return {
      error: widgetJson(
        request,
        { error: result.reason === "expired" ? "Session expired." : "Invalid session." },
        { status: 401 },
      ),
    };
  }
  return { claims: result.claims };
}

// ---------------------------------------------------------------------------
// GET — history / reconnect backfill
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const { claims } = auth;

  const after = new URL(request.url).searchParams.get("after");
  if (after && Number.isNaN(Date.parse(after))) {
    return widgetJson(request, { error: "Invalid 'after' timestamp." }, { status: 400 });
  }

  const db = createServiceSupabase();
  let query = db
    .from("messages")
    // Both filters are defense in depth beyond the token's binding — cheap
    // and it means a future bug that mixes up which id came from where fails
    // closed instead of leaking another workspace's conversation.
    .select("id, author_type, body_text, created_at")
    .eq("conversation_id", claims.conversationId)
    .eq("workspace_id", claims.workspaceId)
    .order("created_at", { ascending: true })
    .limit(200);

  if (after) query = query.gt("created_at", after);

  const { data, error } = await query;
  if (error) {
    console.error("[widget/messages] GET failed", error);
    return widgetJson(request, { error: "Internal error." }, { status: 500 });
  }

  return widgetJson(request, {
    messages: (data ?? []).map((m) => ({
      id: m.id,
      authorType: m.author_type,
      bodyText: m.body_text,
      createdAt: m.created_at,
    })),
  });
}

// ---------------------------------------------------------------------------
// POST — send a message
// ---------------------------------------------------------------------------

const SendSchema = z.object({
  body: z.string().trim().min(1, "Message cannot be empty.").max(4000),
});

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  const { claims } = auth;

  const limited = rateLimit(clientKey(request, `widget-send:${claims.contactId}`), {
    limit: 20,
    windowMs: 60 * 1000,
  });
  if (!limited.ok) {
    return widgetJson(request, { error: "You're sending messages too quickly." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = SendSchema.safeParse(json);
  if (!parsed.success) {
    return widgetJson(
      request,
      { error: parsed.error.issues[0]?.message ?? "Invalid message." },
      { status: 400 },
    );
  }

  const db = createServiceSupabase();
  const { data: message, error } = await db
    .from("messages")
    .insert({
      workspace_id: claims.workspaceId,
      conversation_id: claims.conversationId,
      author_type: "contact",
      body_text: parsed.data.body,
    })
    .select("id, author_type, body_text, created_at")
    .single();

  if (error || !message) {
    console.error("[widget/messages] insert failed", error);
    return widgetJson(request, { error: "Could not send message." }, { status: 500 });
  }

  // Best-effort push to any live widget/agent connection; the message is
  // already durable, and a dropped broadcast is recovered by backfill.
  await broadcast(claims.conversationId, {
    event: "message",
    payload: {
      id: message.id,
      conversationId: claims.conversationId,
      authorType: message.author_type,
      bodyText: message.body_text,
      createdAt: message.created_at,
    },
  });

  return widgetJson(
    request,
    {
      id: message.id,
      authorType: message.author_type,
      bodyText: message.body_text,
      createdAt: message.created_at,
    },
    { status: 201 },
  );
}
