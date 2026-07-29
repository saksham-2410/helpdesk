import "server-only";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Look up a workspace's public-facing fields by slug.
 *
 * Backed by the `workspaces_public_read` RLS policy (anon AND authenticated —
 * see 0004_public_read_roles.sql) rather than the service-role client: this
 * data is intentionally public (it powers the demo page and the public KB),
 * so there is no reason to reach for a privileged key to read it.
 */
export interface PublicWorkspace {
  id: string;
  name: string;
  slug: string;
}

export async function getPublicWorkspaceBySlug(
  slug: string,
): Promise<PublicWorkspace | null> {
  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}
