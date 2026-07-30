import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsOverview, ChannelBreakdown, HourBucket, AgentBreakdown } from "./types";

/**
 * Every function here calls a plain RPC through the caller's own RLS-scoped
 * client — same convention as lib/inbox/data.ts. Three of the four
 * Postgres functions behind these calls have no elevated privilege at all;
 * `conversations_member_all` already restricts what they can aggregate over
 * to this workspace. Only analytics_by_agent is SECURITY DEFINER (it joins
 * auth.users to resolve an email), guarded the same way
 * list_workspace_members already is.
 */

export async function getAnalyticsOverview(
  supabase: SupabaseClient,
  workspaceId: string,
  days: number,
): Promise<AnalyticsOverview | null> {
  const { data, error } = await supabase
    .rpc("analytics_overview", { ws: workspaceId, days })
    .single();
  if (error) {
    console.error("[analytics] overview failed", error);
    return null;
  }
  return data as AnalyticsOverview;
}

export async function getChannelBreakdown(
  supabase: SupabaseClient,
  workspaceId: string,
  days: number,
): Promise<ChannelBreakdown[]> {
  const { data, error } = await supabase.rpc("analytics_by_channel", { ws: workspaceId, days });
  if (error) {
    console.error("[analytics] channel breakdown failed", error);
    return [];
  }
  return (data ?? []) as ChannelBreakdown[];
}

export async function getHourlyDistribution(
  supabase: SupabaseClient,
  workspaceId: string,
  days: number,
): Promise<HourBucket[]> {
  const { data, error } = await supabase.rpc("analytics_by_hour", { ws: workspaceId, days });
  if (error) {
    console.error("[analytics] hourly distribution failed", error);
    return [];
  }
  return (data ?? []) as HourBucket[];
}

export async function getAgentBreakdown(
  supabase: SupabaseClient,
  workspaceId: string,
  days: number,
): Promise<AgentBreakdown[]> {
  const { data, error } = await supabase.rpc("analytics_by_agent", { ws: workspaceId, days });
  if (error) {
    console.error("[analytics] agent breakdown failed", error);
    return [];
  }
  return (data ?? []) as AgentBreakdown[];
}
