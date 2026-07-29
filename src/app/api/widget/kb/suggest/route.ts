import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getPublicWorkspaceBySlug } from "@/lib/workspace/public";
import { searchArticles } from "@/lib/kb/data";
import { widgetJson, widgetPreflight, widgetSafe } from "@/lib/widget/cors";
import { rateLimit, clientKey } from "@/lib/rate-limit";

/**
 * GET /api/widget/kb/suggest?workspace=<slug>&q=<query>
 *
 * Called by the widget, debounced, as a visitor types — surfaces matching
 * help articles before they ever send a message. Backed by the
 * `kb_articles_public_read` RLS policy (published only, granted to `anon`),
 * so this uses the ordinary anon-scoped client rather than service-role:
 * there is nothing here that needs a privileged key, the same reasoning as
 * the public /help pages.
 */

const QuerySchema = z.object({
  workspace: z.string().trim().min(1).max(64),
  q: z.string().trim().min(2).max(200),
});

export async function OPTIONS(request: Request) {
  return widgetPreflight(request);
}

export async function GET(request: Request) {
  const limited = rateLimit(clientKey(request, "kb-suggest"), {
    limit: 60,
    windowMs: 60 * 1000,
  });
  if (!limited.ok) {
    return widgetJson(request, { error: "Too many requests." }, { status: 429 });
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    workspace: url.searchParams.get("workspace"),
    q: url.searchParams.get("q"),
  });
  if (!parsed.success) {
    return widgetJson(request, { articles: [] });
  }

  return widgetSafe(request, () => handleSuggest(request, parsed.data.workspace, parsed.data.q));
}

async function handleSuggest(request: Request, workspaceSlug: string, query: string): Promise<Response> {
  const workspace = await getPublicWorkspaceBySlug(workspaceSlug);
  if (!workspace) {
    return widgetJson(request, { articles: [] });
  }

  const supabase = await createServerSupabase();
  const articles = await searchArticles(supabase, workspace.id, query, 3);

  return widgetJson(request, { articles });
}
