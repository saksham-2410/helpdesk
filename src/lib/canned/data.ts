import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CannedResponse } from "./types";

/** RLS-scoped, same convention as the other lib/ data modules — no
 *  service-role path, canned_member_all already restricts reads/writes to
 *  the caller's own workspace. */
export async function listCannedResponses(
  supabase: SupabaseClient,
  workspaceId: string,
): Promise<CannedResponse[]> {
  const { data, error } = await supabase
    .from("canned_responses")
    .select("id, title, shortcut, body_text")
    .eq("workspace_id", workspaceId)
    .order("shortcut", { ascending: true });

  if (error) {
    console.error("[canned] listCannedResponses failed", error);
    return [];
  }
  return data as CannedResponse[];
}
