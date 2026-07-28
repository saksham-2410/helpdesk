import Link from "next/link";

/**
 * Split auth shell. The left panel is the only place in the product that gets
 * to be expressive — everything past sign-in is a working tool and stays
 * restrained. On mobile it collapses to a compact header so the form is above
 * the fold on a phone.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* Brand panel */}
      <aside className="texture-grain relative hidden overflow-hidden bg-petrol-900 px-12 py-14 lg:flex lg:flex-col lg:justify-between">
        {/* Depth without a stock gradient: two offset radial washes. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 80% at 15% 10%, rgba(67,145,140,0.30), transparent 60%), radial-gradient(90% 70% at 85% 95%, rgba(217,83,35,0.14), transparent 55%)",
          }}
        />

        <Link
          href="/"
          className="relative z-10 inline-flex items-baseline gap-2 text-paper-50"
        >
          <span className="font-serif text-2xl leading-none">Helpdesk</span>
          <span className="size-1.5 rounded-full bg-signal-400" aria-hidden />
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="font-serif text-[2.75rem] leading-[1.1] text-paper-50">
            Every conversation,
            <br />
            <span className="italic text-petrol-200">in one place.</span>
          </p>
          <p className="mt-6 text-[0.9375rem] leading-relaxed text-petrol-100/80">
            Live chat and email land in the same inbox. Your knowledge base
            answers before an agent has to. Long threads arrive already
            summarised.
          </p>
        </div>

        <dl className="relative z-10 grid grid-cols-3 gap-6 border-t border-petrol-200/15 pt-8">
          {[
            ["Channels", "Chat + email"],
            ["Threading", "RFC 5322"],
            ["Triage", "AI summaries"],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="label-eyebrow !text-petrol-300">{k}</dt>
              <dd className="mt-1.5 text-sm text-paper-100">{v}</dd>
            </div>
          ))}
        </dl>
      </aside>

      {/* Form panel */}
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link
            href="/"
            className="mb-10 inline-flex items-baseline gap-2 lg:hidden"
          >
            <span className="font-serif text-2xl leading-none">Helpdesk</span>
            <span className="size-1.5 rounded-full bg-signal-500" aria-hidden />
          </Link>
          {children}
        </div>
      </main>
    </div>
  );
}
