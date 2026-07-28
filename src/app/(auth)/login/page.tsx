import Link from "next/link";
import { signIn } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  // searchParams is a Promise in Next.js 16 — synchronous access was removed.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <>
      <header className="mb-8">
        <h1 className="text-[2rem] leading-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          Pick up where your team left off.
        </p>
      </header>

      <AuthForm mode="login" action={signIn} next={next} />

      <p className="mt-8 text-sm text-muted">
        New here?{" "}
        <Link
          href="/signup"
          className="font-medium text-accent underline-offset-4 hover:underline"
        >
          Create a workspace
        </Link>
      </p>
    </>
  );
}
