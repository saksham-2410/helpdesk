import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/service";
import { signVisitorToken } from "@/lib/widget/token";
import { widgetJson, widgetPreflight, widgetSafe } from "@/lib/widget/cors";
import { rateLimit, clientKey } from "@/lib/rate-limit";

/**
 * POST /api/widget/session
 *
 * Called once when the widget mounts. Resolves (or creates) the visitor's
 * contact record and their ongoing chat conversation, mints a session token
 * scoped to exactly that pair, and returns enough history to render
 * immediately — one round trip instead of session-then-history.
 *
 * Runs entirely on the service-role client: the caller has no Supabase
 * identity to authenticate as. Every query below is therefore scoped by
 * workspace_id explicitly, by hand — there is no RLS safety net here.
 */

const RequestSchema = z.object({
  workspaceSlug: z
    .string()
    .trim()
    .min(1)
    .max(64),
  // Client-generated and persisted in localStorage across visits. Not
  // required to be a UUID — just an opaque, sufficiently random identifier —
  // so the widget's own ID generation strategy isn't locked to this schema.
  visitorId: z
    .string()
    .trim()
    .min(8)
    .max(128)
    .regex(/^[a-zA-Z0-9_-]+$/, "visitorId contains invalid characters"),
  email: z.string().trim().toLowerCase().email().optional(),
  name: z.string().trim().min(1).max(120).optional(),
});

const HISTORY_LIMIT = 50;

export async function OPTIONS(request: Request) {
  return widgetPreflight(request);
}

export async function POST(request: Request) {
  const limited = await rateLimit(clientKey(request, "widget-session"), {
    limit: 30,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.ok) {
    return widgetJson(request, { error: "Too many requests." }, { status: 429 });
  }

  const json = await request.json().catch(() => null);
  const parsed = RequestSchema.safeParse(json);
  if (!parsed.success) {
    return widgetJson(
      request,
      { error: "Invalid request.", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const { workspaceSlug, visitorId, email, name } = parsed.data;

  return widgetSafe(request, () => handleSession({ workspaceSlug, visitorId, email, name }, request));
}

async function handleSession(
  { workspaceSlug, visitorId, email, name }: z.infer<typeof RequestSchema>,
  request: Request,
): Promise<Response> {
  const db = createServiceSupabase();

  const { data: workspace, error: workspaceError } = await db
    .from("workspaces")
    .select("id, name, slug, settings")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (workspaceError) {
    console.error("[widget/session] workspace lookup failed", workspaceError);
    return widgetJson(request, { error: "Internal error." }, { status: 500 });
  }
  if (!workspace) {
    return widgetJson(request, { error: "Unknown workspace." }, { status: 404 });
  }

  // Find-or-create rather than upsert: contacts_workspace_visitor is a
  // PARTIAL unique index (WHERE visitor_id IS NOT NULL), and PostgREST's
  // upsert helper cannot target a partial index's predicate — it would emit
  // an ON CONFLICT clause Postgres rejects as not matching any constraint.
  // The tiny race this leaves (two first-ever requests for a brand-new
  // visitor id landing at the same instant) is accepted rather than solved
  // with a second migration for a near-zero-probability duplicate contact.
  let contactId: string;
  const { data: existingContact, error: contactLookupError } = await db
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq("visitor_id", visitorId)
    .maybeSingle();

  if (contactLookupError) {
    console.error("[widget/session] contact lookup failed", contactLookupError);
    return widgetJson(request, { error: "Internal error." }, { status: 500 });
  }

  if (existingContact) {
    contactId = existingContact.id;
    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() };
    if (email) patch.email = email;
    if (name) patch.name = name;
    await db.from("contacts").update(patch).eq("id", contactId);
  } else {
    const { data: created, error: createError } = await db
      .from("contacts")
      .insert({
        workspace_id: workspace.id,
        visitor_id: visitorId,
        email: email ?? null,
        name: name ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (createError || !created) {
      console.error("[widget/session] contact creation failed", createError);
      return widgetJson(request, { error: "Internal error." }, { status: 500 });
    }
    contactId = created.id;
  }

  // One ongoing chat conversation per contact. The message-insert trigger
  // (0003_functions.sql) reopens it automatically when the contact writes
  // again after it was resolved or snoozed, so reusing it unconditionally —
  // rather than branching on status — is correct and simpler.
  const { data: existingConversation, error: convLookupError } = await db
    .from("conversations")
    .select("id")
    .eq("contact_id", contactId)
    .eq("channel", "chat")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (convLookupError) {
    console.error("[widget/session] conversation lookup failed", convLookupError);
    return widgetJson(request, { error: "Internal error." }, { status: 500 });
  }

  let conversationId: string;
  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    const { data: createdConv, error: createConvError } = await db
      .from("conversations")
      .insert({
        workspace_id: workspace.id,
        contact_id: contactId,
        channel: "chat",
        status: "open",
      })
      .select("id")
      .single();

    if (createConvError || !createdConv) {
      console.error("[widget/session] conversation creation failed", createConvError);
      return widgetJson(request, { error: "Internal error." }, { status: 500 });
    }
    conversationId = createdConv.id;
  }

  const { data: history, error: historyError } = await db
    .from("messages")
    .select("id, author_type, body_text, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(HISTORY_LIMIT);

  if (historyError) {
    console.error("[widget/session] history fetch failed", historyError);
    return widgetJson(request, { error: "Internal error." }, { status: 500 });
  }

  const token = await signVisitorToken({ workspaceId: workspace.id, contactId, conversationId });

  const settings = (workspace.settings ?? {}) as { greeting?: string; accentColor?: string };

  return widgetJson(request, {
    token,
    conversationId,
    workspace: {
      name: workspace.name,
      slug: workspace.slug,
      greeting: settings.greeting ?? `Hi! How can we help?`,
      accentColor: settings.accentColor ?? null,
    },
    messages: (history ?? []).map((m) => ({
      id: m.id,
      authorType: m.author_type,
      bodyText: m.body_text,
      createdAt: m.created_at,
    })),
  });
}
