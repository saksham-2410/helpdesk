import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { createWorkspace } from "./actions";
import { OnboardingForm } from "./form";

export const metadata = { title: "Create a workspace" };

/**
 * Recovery path for a signed-in user with no workspace. Reachable if workspace
 * creation failed after the account was made, or if an invite was revoked
 * before it was accepted. Without this the app shell would redirect-loop.
 */
export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspace = await getActiveWorkspace();
  if (workspace) redirect("/inbox");

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <header className="mb-8">
        <h1 className="text-[2rem] leading-tight">One more step</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          Your account is ready but it is not attached to a workspace yet. Name
          one to continue.
        </p>
      </header>
      <OnboardingForm action={createWorkspace} />
    </div>
  );
}
