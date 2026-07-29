import Link from "next/link";
import { createServerSupabase, getCurrentUser } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "Team invite" };

interface InvitePreview {
  workspace_name: string;
  email: string;
  role: "admin" | "agent";
  expires_at: string;
  is_valid: boolean;
}

/**
 * Reachable by someone who is, by construction, not yet a member of the
 * workspace they're being invited to — so this reads via get_invite_preview
 * (0005), a SECURITY DEFINER RPC keyed by the token itself rather than RLS
 * membership. The token is the credential here, the same trust model as any
 * unlisted invite link.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createServerSupabase();
  const user = await getCurrentUser().catch(() => null);

  const { data } = await supabase
    .rpc("get_invite_preview", { invite_token: token })
    .maybeSingle<InvitePreview>();

  if (!data) {
    return (
      <Shell>
        <h1 className="font-serif text-2xl">Invite not found</h1>
        <p className="mt-2 text-sm text-secondary">
          This invite link doesn&rsquo;t match anything. It may have been typed
          incorrectly.
        </p>
      </Shell>
    );
  }

  if (!data.is_valid) {
    return (
      <Shell>
        <h1 className="font-serif text-2xl">This invite has expired</h1>
        <p className="mt-2 text-sm text-secondary">
          Ask an admin at {data.workspace_name} to send you a new one.
        </p>
      </Shell>
    );
  }

  const emailMismatch = user && user.email?.toLowerCase() !== data.email.toLowerCase();

  return (
    <Shell>
      <p className="label-eyebrow mb-3">Team invite</p>
      <h1 className="font-serif text-3xl leading-tight">
        Join <span className="italic">{data.workspace_name}</span>
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-secondary">
        You&rsquo;ve been invited as{" "}
        <Badge tone={data.role === "admin" ? "accent" : "neutral"}>{data.role}</Badge> using{" "}
        <span className="font-medium text-primary">{data.email}</span>.
      </p>

      {!user && (
        <div className="mt-7 space-y-2.5">
          <Link href={`/signup?next=${encodeURIComponent(`/invite/${token}`)}`}>
            <Button variant="primary" size="lg" className="w-full">
              Create an account to accept
            </Button>
          </Link>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
            <Button variant="secondary" size="lg" className="w-full">
              I already have an account
            </Button>
          </Link>
        </div>
      )}

      {user && emailMismatch && (
        <div className="mt-7 rounded-md border border-warning-500/30 bg-warning-100 px-4 py-3 text-sm leading-relaxed text-warning-700 dark:bg-warning-700/20 dark:text-warning-100">
          You&rsquo;re signed in as <strong>{user.email}</strong>, but this invite was
          sent to <strong>{data.email}</strong>. Sign out and sign back in with the
          invited address to accept it.
        </div>
      )}

      {user && !emailMismatch && (
        <div className="mt-7">
          <AcceptForm token={token} />
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      {children}
    </main>
  );
}
