import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/field";
import { Avatar, Badge, ChannelBadge, StatusPill } from "@/components/ui/badge";

export const metadata = { title: "Styleguide" };

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-8">
      <div className="mb-5">
        <h2 className="text-xl">{title}</h2>
        {note && <p className="mt-1 max-w-2xl text-sm text-muted">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const RAMPS = [
  { name: "paper", note: "warm neutral — canvas, surfaces, borders, secondary text", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  { name: "petrol", note: "the system voice — primary actions, focus, agent bubbles", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  { name: "signal", note: "needs a human now — never decoration", steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
];

export default function Styleguide() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <header className="mb-12">
        <p className="label-eyebrow mb-3">Design system</p>
        <h1 className="text-5xl leading-[1.05]">
          Field Notes
          <span className="ml-3 align-middle text-machine text-sm">v1</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[0.9375rem] leading-relaxed text-secondary">
          A support desk should read like a well-made instrument, not a SaaS template. Warm paper
          neutrals instead of the cold slate every competitor defaults to. Coral reserved strictly
          for things that need a human right now. Type that encodes audience: serif for what the
          customer reads, sans for dense agent surfaces, mono for machine facts.
        </p>
      </header>

      <div className="space-y-12">
        <Section title="Typography" note="Instrument Serif, Instrument Sans, and JetBrains Mono — deliberately not Inter or system-ui.">
          <div className="space-y-6 rounded-lg border border-border-subtle bg-surface p-7">
            <div>
              <p className="label-eyebrow mb-2">Serif · customer-facing</p>
              <p className="font-serif text-4xl leading-tight">How do I connect a custom domain?</p>
              <p className="mt-1 text-machine">Instrument Serif 400 · knowledge base, empty states, headings</p>
            </div>
            <div className="border-t border-border-subtle pt-6">
              <p className="label-eyebrow mb-2">Sans · agent surfaces</p>
              <p className="text-base leading-relaxed text-secondary">
                The customer cannot complete checkout on Safari. They have already cleared cache and
                tried an incognito window. Awaiting a reproduction from the billing team.
              </p>
              <p className="mt-1 text-machine">Instrument Sans · inbox, forms, controls</p>
            </div>
            <div className="border-t border-border-subtle pt-6">
              <p className="label-eyebrow mb-2">Mono · machine facts</p>
              <p className="font-mono text-xs text-secondary">
                conv_8f2a10c4 · Message-ID: &lt;CAJx9k2@mail.gmail.com&gt; · 14:32:07
              </p>
              <p className="mt-1 text-machine">JetBrains Mono · ids, timestamps, email headers</p>
            </div>
          </div>
        </Section>

        <Section title="Colour" note="Three ramps do all the work. Semantic tokens sit on top so dark mode is one set of overrides.">
          <div className="space-y-7">
            {RAMPS.map((ramp) => (
              <div key={ramp.name}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-xs font-medium text-primary">{ramp.name}</span>
                  <span className="text-xs text-muted">{ramp.note}</span>
                </div>
                <div className="flex overflow-hidden rounded-md shadow-hairline">
                  {ramp.steps.map((step) => (
                    <div key={step} className="flex-1">
                      {/* Read the token directly rather than composing a class name:
                          Tailwind only generates utilities it can see as literal
                          strings, so `bg-${name}-${step}` would never exist. */}
                      <div
                        className="h-14"
                        style={{ background: `var(--color-${ramp.name}-${step})` }}
                      />
                      <div className="bg-surface py-1 text-center font-mono text-[0.5625rem] text-muted">
                        {step}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Buttons" note="One primary action per view. Everything else recedes.">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface p-7">
            <Button variant="primary">Send reply</Button>
            <Button variant="secondary">Assign</Button>
            <Button variant="subtle">Generate summary</Button>
            <Button variant="ghost">Snooze</Button>
            <Button variant="danger">Delete</Button>
            <Button variant="primary" loading>Sending</Button>
            <Button variant="secondary" disabled>Disabled</Button>
            <Button variant="secondary" size="sm">Small</Button>
            <Button variant="primary" size="lg">Large</Button>
          </div>
        </Section>

        <Section title="Status and identity" note="Status carries a dot as well as a colour — colour alone fails for colour-blind operators.">
          <div className="flex flex-wrap items-center gap-6 rounded-lg border border-border-subtle bg-surface p-7">
            <div className="flex items-center gap-2">
              <StatusPill status="open" />
              <StatusPill status="snoozed" />
              <StatusPill status="resolved" />
            </div>
            <div className="flex items-center gap-3 border-l border-border-subtle pl-6">
              <ChannelBadge channel="chat" />
              <ChannelBadge channel="email" />
              <span className="text-xs text-muted">channel</span>
            </div>
            <div className="flex items-center gap-2 border-l border-border-subtle pl-6">
              <Avatar name="Aditya Rao" />
              <Avatar name="Priya Nair" />
              <Avatar email="sam@acme.com" />
              <Avatar name="Unassigned" size="sm" />
            </div>
            <div className="flex items-center gap-2 border-l border-border-subtle pl-6">
              <Badge tone="accent">AI</Badge>
              <Badge tone="neutral">Billing</Badge>
              <Badge tone="danger">SLA breach</Badge>
            </div>
          </div>
        </Section>

        <Section title="Forms">
          <div className="grid max-w-xl gap-5 rounded-lg border border-border-subtle bg-surface p-7">
            <Field label="Work email" htmlFor="sg-email" required hint="Used for the sign-in link.">
              <Input type="email" placeholder="you@company.com" />
            </Field>
            <Field label="Workspace name" htmlFor="sg-ws" error="That workspace name is already taken.">
              <Input defaultValue="Acme Support" />
            </Field>
            <Field label="Canned reply" htmlFor="sg-reply">
              <Textarea placeholder="Thanks for reaching out — I'm looking into this now." />
            </Field>
          </div>
        </Section>

        <Section title="Elevation" note="Shadows tinted with warm ink rather than pure black. Black shadows on a warm canvas look like dirt.">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(["low", "mid", "high", "widget"] as const).map((s) => (
              <div
                key={s}
                className="rounded-lg bg-surface p-5"
                style={{ boxShadow: `var(--shadow-${s})` }}
              >
                <p className="font-mono text-xs text-secondary">{s}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </main>
  );
}
