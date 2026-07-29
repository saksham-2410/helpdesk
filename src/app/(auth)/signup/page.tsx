import Link from "next/link";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create your workspace" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const isInvite = typeof next === "string" && next.startsWith("/invite/");
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[2rem] leading-tight">
          {isInvite ? "Create your account" : "Create your workspace"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          {isInvite
            ? "You're accepting a team invite, so there's no workspace to name — you'll join the one you were invited to next."
            : "One workspace holds your inbox, your team, and your knowledge base. No credit card, no email confirmation."}
        </p>
      </header>

      <AuthForm mode="signup" action={signUp} next={next} skipWorkspaceName={isInvite} />

      <p className="mt-8 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href={loginHref}
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
