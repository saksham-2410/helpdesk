"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";

export interface ActionState {
  error?: string;
}

/** RLS (`canned_member_all`) is the real boundary — any agent can manage the
 *  team's canned responses, matching how KB articles work (only team
 *  membership itself, not per-resource admin status, is gated). */

const ShortcutSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Shortcut is required.")
  .max(32, "Keep the shortcut short.")
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Letters, numbers, and hyphens only — no spaces or a leading slash.");

const CannedSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(120),
  shortcut: ShortcutSchema,
  bodyText: z.string().trim().min(1, "Body can't be empty.").max(5000),
});

export async function createCannedResponse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = CannedSchema.safeParse({
    title: formData.get("title"),
    shortcut: formData.get("shortcut"),
    bodyText: formData.get("bodyText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const workspace = await requireWorkspace();
  const user = await getCurrentUser();
  const supabase = await createServerSupabase();

  const { error } = await supabase.from("canned_responses").insert({
    workspace_id: workspace.id,
    title: parsed.data.title,
    shortcut: parsed.data.shortcut,
    body_text: parsed.data.bodyText,
    body_html: "",
    created_by: user?.id ?? null,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "That shortcut is already in use." : error.message,
    };
  }

  revalidatePath("/settings");
  return {};
}

export async function updateCannedResponse(
  id: string,
  formData: FormData,
): Promise<ActionState> {
  const parsed = CannedSchema.safeParse({
    title: formData.get("title"),
    shortcut: formData.get("shortcut"),
    bodyText: formData.get("bodyText"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const supabase = await createServerSupabase();
  const { error } = await supabase
    .from("canned_responses")
    .update({
      title: parsed.data.title,
      shortcut: parsed.data.shortcut,
      body_text: parsed.data.bodyText,
    })
    .eq("id", id);

  if (error) {
    return {
      error: error.code === "23505" ? "That shortcut is already in use." : error.message,
    };
  }

  revalidatePath("/settings");
  return {};
}

export async function deleteCannedResponse(id: string): Promise<ActionState> {
  const supabase = await createServerSupabase();
  const { error } = await supabase.from("canned_responses").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return {};
}
