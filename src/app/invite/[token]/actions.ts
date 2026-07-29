"use server";

import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AcceptState {
  error?: string;
}

/**
 * Thin wrapper around the accept_invite RPC (0003_functions.sql), which does
 * the actual authorization: the invite's token must resolve to a pending,
 * unexpired row whose email matches the caller's own verified session email.
 * A signed-in user cannot redeem an invite issued to someone else's address.
 */
export async function acceptInvite(token: string): Promise<AcceptState> {
  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  }

  const { error } = await supabase.rpc("accept_invite", { invite_token: token });
  if (error) return { error: error.message };

  redirect("/inbox");
}
