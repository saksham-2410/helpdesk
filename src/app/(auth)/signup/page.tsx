import Link from "next/link";
import { signUp } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Create your workspace" };

export default function SignupPage() {
  return (
    <>
      <header className="mb-8">
        <h1 className="text-[2rem] leading-tight">Create your workspace</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          One workspace holds your inbox, your team, and your knowledge base.
          No credit card, no email confirmation.
        </p>
      </header>

      <AuthForm mode="signup" action={signUp} />

      <p className="mt-8 text-sm text-muted">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
