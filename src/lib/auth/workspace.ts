import "server-only";
import { cache } from "react";
import { createServerSupabase } from "@/lib/supabase/server";

export type WorkspaceRole = "admin" | "agent";

export interface ActiveWorkspace {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
}

/**
 * The signed-in user's workspace, or null if they have none yet.
 *
 * Wrapped in React's `cache()` so the several server components that need it
 * during one render (layout, sidebar, page) share a single query rather than
 * issuing one each.
 *
 * A user could belong to several workspaces; the assignment does not require a
 * switcher, so this deterministically picks the earliest membership. Modelled
 * as many-to-many in the schema so adding a switcher later is a UI change
 * rather than a migration — noted as a deliberate deferral in the README.
 */
export const getActiveWorkspace = cache(async (): Promise<ActiveWorkspace | null> => {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, slug)")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data?.workspace) return null;

  // PostgREST types an embedded to-one relation as possibly-array; normalise.
  const ws = Array.isArray(data.workspace) ? data.workspace[0] : data.workspace;
  if (!ws) return null;

  return {
    id: ws.id as string,
    name: ws.name as string,
    slug: ws.slug as string,
    role: data.role as WorkspaceRole,
  };
});

/** Throws if there is no workspace. For pages already behind the auth proxy. */
export async function requireWorkspace(): Promise<ActiveWorkspace> {
  const ws = await getActiveWorkspace();
  if (!ws) throw new Error("NO_WORKSPACE");
  return ws;
}
