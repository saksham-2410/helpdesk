"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export interface OnboardingState {
  error?: string;
}

const Schema = z.object({
  workspaceName: z
    .string()
    .trim()
    .min(2, "Give your workspace a name.")
    .max(80, "That name is too long."),
});

export async function createWorkspace(
  _prev: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  const parsed = Schema.safeParse({ workspaceName: formData.get("workspaceName") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("create_workspace_for_user", {
    workspace_name: parsed.data.workspaceName,
    desired_slug: null,
  });

  if (error) return { error: error.message };

  redirect("/inbox");
}
