import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import { Avatar, Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOut } from "../(auth)/actions";
import { SidebarNav } from "./nav";

/**
 * Agent shell. Fixed sidebar, scrollable main region — the inbox manages its
 * own internal scrolling, so the page itself never scrolls.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const workspace = await getActiveWorkspace();
  // Signed in but with no workspace — only reachable if workspace creation
  // failed midway. Send them somewhere that can fix it rather than rendering
  // a broken shell.
  if (!workspace) redirect("/onboarding");

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="flex w-[228px] shrink-0 flex-col border-r border-border-subtle bg-surface">
        <div className="px-4 pb-3 pt-4">
          <div className="flex items-baseline gap-1.5">
            <span className="font-serif text-xl leading-none">Helpdesk</span>
            <span className="size-1.5 rounded-full bg-signal-500" aria-hidden />
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border-subtle bg-canvas px-2.5 py-2">
            <Avatar name={workspace.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] font-medium leading-tight">
                {workspace.name}
              </p>
              <p className="truncate text-machine !text-[0.6875rem]">
                /{workspace.slug}
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-2.5">
          <SidebarNav />
        </div>

        <div className="border-t border-border-subtle p-2.5">
          <div className="flex items-center gap-2 px-1.5 py-1.5">
            <Avatar email={user.email} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.8125rem] leading-tight">
                {user.email}
              </p>
              <Badge tone={workspace.role === "admin" ? "accent" : "neutral"} className="mt-1">
                {workspace.role}
              </Badge>
            </div>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="mt-1 w-full justify-start">
              Sign out
            </Button>
          </form>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {children}
      </main>
    </div>
  );
}
