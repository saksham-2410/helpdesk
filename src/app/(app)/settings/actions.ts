"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { sendInviteEmail } from "@/lib/email/send-invite";
import { env } from "@/lib/env";

export interface ActionState {
  error?: string;
  notice?: string;
}

/**
 * Every action re-derives the caller's workspace and role from the session
 * rather than trusting a workspaceId passed from the client, and every write
 * goes through either RLS (`invites_admin_all`) or a SECURITY DEFINER RPC
 * that independently checks `is_workspace_admin()`. A hidden "Invite" button
 * in the UI is not the security boundary — the database is.
 */

const InviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "agent"]),
});

export async function createInvite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid invite." };
  }

  const workspace = await requireWorkspace();
  if (workspace.role !== "admin") {
    return { error: "Only an admin can invite team members." };
  }

  const supabase = await createServerSupabase();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Re-inviting an already-pending email replaces it rather than erroring —
  // matches the unique partial index (workspace_id, email) where accepted_at
  // is null, and is the behavior an admin actually wants ("resend/refresh
  // this invite") rather than a confusing conflict error.
  await supabase
    .from("invites")
    .delete()
    .eq("workspace_id", workspace.id)
    .eq("email", parsed.data.email)
    .is("accepted_at", null);

  const { data: invite, error } = await supabase
    .from("invites")
    .insert({
      workspace_id: workspace.id,
      email: parsed.data.email,
      role: parsed.data.role,
      invited_by: user.id,
    })
    .select("token")
    .single();

  if (error || !invite) {
    return { error: error?.message ?? "Could not create the invite." };
  }

  const inviteUrl = `${env.appUrl}/invite/${invite.token}`;
  const result = await sendInviteEmail({
    to: parsed.data.email,
    workspaceName: workspace.name,
    inviterEmail: user.email ?? "A teammate",
    inviteUrl,
  });

  revalidatePath("/settings");

  // Email delivery is best-effort — the invite row and its link are the
  // source of truth regardless of whether Resend is configured or the send
  // succeeds, so a failed send is reported as a notice, not an error.
  return result.sent
    ? { notice: `Invite sent to ${parsed.data.email}.` }
    : { notice: `Invite created. Share this link — email wasn't sent (${result.error ?? "email not configured"}).` };
}

export async function revokeInvite(inviteId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  if (workspace.role !== "admin") return { error: "Only an admin can revoke invites." };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("invites")
    .delete()
    .eq("id", inviteId)
    .eq("workspace_id", workspace.id);

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

export async function removeMember(userId: string): Promise<ActionState> {
  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("remove_workspace_member", {
    ws: workspace.id,
    target_user_id: userId,
  });

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}

const RoleSchema = z.enum(["admin", "agent"]);

export async function updateMemberRole(userId: string, role: string): Promise<ActionState> {
  const parsedRole = RoleSchema.safeParse(role);
  if (!parsedRole.success) return { error: "Invalid role." };

  const workspace = await requireWorkspace();
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("update_workspace_member_role", {
    ws: workspace.id,
    target_user_id: userId,
    new_role: parsedRole.data,
  });

  if (error) return { error: error.message };
  revalidatePath("/settings");
  return {};
}
