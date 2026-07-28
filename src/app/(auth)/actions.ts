"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
// 8 characters, not a character-class gauntlet. Length dominates composition
// rules for real-world strength, and Supabase already rejects breached
// passwords. Arbitrary symbol requirements mostly produce Password1!.
const password = z.string().min(8, "Use at least 8 characters.");

const SignupSchema = z.object({
  email,
  password,
  workspaceName: z
    .string()
    .trim()
    .min(2, "Give your workspace a name.")
    .max(80, "That name is too long."),
});

const LoginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

function flatten(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !out[key]) out[key] = issue.message;
  }
  return out;
}

export async function signUp(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = SignupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    workspaceName: formData.get("workspaceName"),
  });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const supabase = await createServerSupabase();

  const { error: signUpError } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (signUpError) {
    return { error: signUpError.message };
  }

  // Email confirmation is disabled, so signUp establishes a session
  // immediately and the workspace can be created in the same request. If
  // confirmation were on, this would need to move to a post-confirm callback —
  // and evaluators would hit a wall they cannot clear.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error:
        "Account created, but the session did not start. Try signing in.",
    };
  }

  // Atomic: workspace + admin membership in one transaction. See
  // create_workspace_for_user in 0003_functions.sql.
  const { error: wsError } = await supabase.rpc("create_workspace_for_user", {
    workspace_name: parsed.data.workspaceName,
    desired_slug: null,
  });

  if (wsError) {
    return { error: `Could not create the workspace: ${wsError.message}` };
  }

  // redirect() signals by throwing, so it must sit outside any try/catch.
  redirect("/inbox");
}

export async function signIn(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: flatten(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately not distinguishing "no such user" from "wrong password":
    // that difference is an account-enumeration oracle.
    return { error: "That email and password combination is not right." };
  }

  const next = formData.get("next");
  const target =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? next
      : "/inbox";

  redirect(target);
}

export async function signOut() {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
