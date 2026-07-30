import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    n: "01",
    title: "One inbox, two channels",
    body: "Live chat and email land in the same queue, with the same assign, snooze, and resolve actions. Filter by channel only when you want to.",
  },
  {
    n: "02",
    title: "Email that actually threads",
    body: "Replies are matched on RFC 5322 Message-ID and References, with a plus-address token and a subject heuristic behind it — because real mail clients strip headers.",
  },
  {
    n: "03",
    title: "Answers before an agent",
    body: "The widget searches your knowledge base as the customer types and suggests articles inline. Many conversations end before they start.",
  },
  {
    n: "04",
    title: "Long threads, already read",
    body: "Open a forty-message escalation and the summary is waiting: what they want, what has been tried, where it stands. It extends as the thread grows.",
  },
];

export default async function LandingPage() {
  // Signed-in users have no reason to read marketing copy.
  const user = await getCurrentUser().catch(() => null);
  if (user) redirect("/inbox");

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-3xl leading-none">Helpdesk</span>
          <span className="size-2 rounded-full bg-signal-500" aria-hidden />
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/demo">
            <Button variant="ghost" size="sm">
              Widget demo
            </Button>
          </Link>
          <Link href="/login">
            <Button variant="secondary" size="sm">
              Sign in
            </Button>
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="py-20 sm:py-28">
          <p className="label-eyebrow mb-5">Customer communication platform</p>
          <h1 className="max-w-3xl text-[clamp(2.5rem,7vw,4.5rem)] leading-[1.02]">
            Every conversation,
            <br />
            <span className="italic text-accent">in one place.</span>
          </h1>
          <p className="mt-7 max-w-xl text-base leading-relaxed text-secondary">
            Chat and email in a single inbox. A knowledge base that answers
            before your team has to. Long threads summarised the moment you open
            them.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/signup">
              <Button variant="primary" size="lg">
                Create a workspace
              </Button>
            </Link>
            <Link href="/demo">
              <Button variant="secondary" size="lg">
                Try the chat widget
              </Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted">
            No credit card. No email confirmation — you are in immediately.
          </p>
        </section>

        <section className="grid gap-px overflow-hidden rounded-xl border border-border-subtle bg-border-subtle sm:grid-cols-2">
          {FEATURES.map((f) => (
            <article key={f.n} className="bg-surface p-7">
              <p className="text-machine mb-3">{f.n}</p>
              <h2 className="text-lg leading-snug">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-secondary">
                {f.body}
              </p>
            </article>
          ))}
        </section>

        <footer className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-border-subtle py-8 text-xs text-muted">
          <p>Helpdesk — chat, email, and a knowledge base in one inbox.</p>
          <Link href="/styleguide" className="hover:text-secondary">
            Design system
          </Link>
        </footer>
      </main>
    </div>
  );
}
