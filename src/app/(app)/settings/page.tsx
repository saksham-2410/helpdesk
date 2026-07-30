import Link from "next/link";
import { PageHeader } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { CopyCode } from "@/components/ui/copy-code";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { requireWorkspace } from "@/lib/auth/workspace";
import { env, features } from "@/lib/env";
import { replyToAddress } from "@/lib/email/threading";
import { TeamSection, type Member, type PendingInvite } from "./team-section";
import { DomainsSection, type WorkspaceDomain } from "./domains-section";
import { CannedSection } from "./canned-section";
import { listCannedResponses } from "@/lib/canned/data";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const workspace = await requireWorkspace();
  const user = await getCurrentUser();
  const supabase = await createServerSupabase();

  // Cast rather than `.returns<T>()`: without generated Database types wired
  // into the client, that helper's inference fights itself on an RPC that
  // returns a set of rows. Plain casts are fine here — both shapes are
  // narrow, hand-written, and match their SQL definitions in 0005.
  const [{ data: membersData }, { data: invitesData }, { data: domainsData }, cannedResponses] =
    await Promise.all([
      supabase.rpc("list_workspace_members", { ws: workspace.id }),
      supabase
        .from("invites")
        .select("id, email, role, expires_at")
        .eq("workspace_id", workspace.id)
        .is("accepted_at", null)
        .order("created_at", { ascending: true }),
      supabase
        .from("workspace_domains")
        .select("id, domain, status, verification, last_error")
        .eq("workspace_id", workspace.id)
        .order("created_at", { ascending: true }),
      listCannedResponses(supabase, workspace.id),
    ]);
  const members = (membersData ?? []) as Member[];
  const invites = (invitesData ?? []) as PendingInvite[];
  const domains = (domainsData ?? []) as WorkspaceDomain[];

  const snippet = `<script src="${env.appUrl}/widget.js" data-workspace="${workspace.slug}" defer></script>`;
  // Reuses the exact function that builds the Reply-To on outbound mail
  // (lib/email/threading.ts) — this is not a display-only copy of the
  // format, it's the same address the inbound webhook actually matches on.
  const supportAddress = features.email ? replyToAddress(workspace.slug, env.emailDomain) : null;

  return (
    <>
      <PageHeader title="Settings" description="Team, widget install, and workspace details." />

      <div className="mx-auto w-full max-w-2xl space-y-10 overflow-y-auto px-6 py-8">
        <section>
          <h2 className="mb-1 font-serif text-xl">{workspace.name}</h2>
          <p className="text-machine">/{workspace.slug}</p>
        </section>

        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-xl">Chat widget</h2>
            <Link href={`/demo?workspace=${workspace.slug}`} target="_blank">
              <Button variant="secondary" size="sm">
                Open demo page
              </Button>
            </Link>
          </div>
          <p className="mb-3 text-sm leading-relaxed text-secondary">
            Paste this before the closing <code className="text-machine">&lt;/body&gt;</code> tag
            of any site to install live chat.
          </p>
          <CopyCode code={snippet} />
        </section>

        {supportAddress && (
          <section>
            <h2 className="mb-3 font-serif text-xl">Email</h2>
            <p className="mb-3 text-sm leading-relaxed text-secondary">
              Publish this as your support address — anything sent to it lands in your Inbox as a
              new conversation, and replies thread automatically in the customer&apos;s mail client.
              It&apos;s specific to this workspace, so it works correctly no matter how many other
              workspaces exist on this deployment.
            </p>
            <CopyCode code={supportAddress} />
          </section>
        )}

        <section>
          <h2 className="mb-3 font-serif text-xl">Team</h2>
          <TeamSection
            members={members}
            invites={invites}
            currentUserId={user!.id}
            isAdmin={workspace.role === "admin"}
          />
        </section>

        <CannedSection responses={cannedResponses} />

        <DomainsSection
          domains={domains}
          isAdmin={workspace.role === "admin"}
          customDomainsAutomated={features.customDomains}
        />
      </div>
    </>
  );
}
