"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { addDomain, verifyDomain, removeDomain, type ActionState } from "./domain-actions";

export interface WorkspaceDomain {
  id: string;
  domain: string;
  status: "pending" | "verifying" | "active" | "failed";
  verification: { type: string; domain?: string; value: string }[];
  last_error: string | null;
}

const STATUS_TONE = {
  pending: "neutral",
  verifying: "warning",
  active: "success",
  failed: "danger",
} as const;

function AddSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="sm" loading={pending}>
      {pending ? "Connecting…" : "Connect"}
    </Button>
  );
}

function AddDomainForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(addDomain, {});
  return (
    <form action={formAction} className="flex items-end gap-2">
      <Field
        label="Domain"
        htmlFor="new-domain"
        hint="A subdomain (help.yourcompany.com) is simplest — it only needs one CNAME record."
        className="flex-1"
      >
        <Input id="new-domain" name="domain" placeholder="help.yourcompany.com" required />
      </Field>
      <AddSubmit />
      {state.error && <p className="pb-2 text-xs text-danger-500">{state.error}</p>}
    </form>
  );
}

export function DomainsSection({
  domains,
  isAdmin,
  customDomainsAutomated,
}: {
  domains: WorkspaceDomain[];
  isAdmin: boolean;
  customDomainsAutomated: boolean;
}) {
  return (
    <section>
      <h2 className="mb-1 font-serif text-xl">Custom domain</h2>
      <p className="mb-3 text-sm leading-relaxed text-secondary">
        Serve your public help centre on your own domain instead of this app&apos;s.
        {!customDomainsAutomated && (
          <> Automatic provisioning isn&apos;t configured — connect a domain and add the DNS record
            shown; verification is manual for now.</>
        )}
      </p>

      {isAdmin && <AddDomainForm />}

      {domains.length > 0 && (
        <ul className="mt-4 space-y-3">
          {domains.map((d) => (
            <DomainRow key={d.id} domain={d} isAdmin={isAdmin} />
          ))}
        </ul>
      )}
    </section>
  );
}

function DomainRow({ domain, isAdmin }: { domain: WorkspaceDomain; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(domain.status !== "active");

  function handleVerify() {
    setError(null);
    startTransition(async () => {
      const result = await verifyDomain(domain.id);
      if (result.error) setError(result.error);
    });
  }

  function handleRemove() {
    if (!confirm(`Disconnect ${domain.domain}?`)) return;
    startTransition(async () => {
      await removeDomain(domain.id);
    });
  }

  return (
    <li className="rounded-lg border border-border-subtle bg-surface">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium">{domain.domain}</p>
        </button>
        <Badge tone={STATUS_TONE[domain.status]}>{domain.status}</Badge>
        {isAdmin && (
          <>
            <Button variant="ghost" size="sm" disabled={pending} onClick={handleVerify}>
              Check status
            </Button>
            <Button variant="ghost" size="sm" disabled={pending} onClick={handleRemove}>
              Remove
            </Button>
          </>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border-subtle px-4 py-3">
          {domain.verification.length === 0 ? (
            <p className="text-xs text-secondary">
              Already fully configured — no DNS changes pending.
            </p>
          ) : (
            <>
              <p className="mb-2 text-xs text-secondary">Add this DNS record at your registrar:</p>
              <div className="overflow-x-auto rounded-md border border-border-subtle">
                <table className="w-full text-left text-xs">
                  <thead className="bg-paper-100 text-secondary dark:bg-paper-900">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Type</th>
                      <th className="px-3 py-1.5 font-medium">Name</th>
                      <th className="px-3 py-1.5 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {domain.verification.map((v, i) => (
                      <tr key={i} className="border-t border-border-subtle">
                        <td className="px-3 py-1.5">{v.type}</td>
                        <td className="px-3 py-1.5">{v.domain ?? domain.domain}</td>
                        <td className="px-3 py-1.5">{v.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {domain.last_error && (
            <p className="mt-2 text-xs text-danger-500">{domain.last_error}</p>
          )}
          {error && <p className="mt-2 text-xs text-danger-500">{error}</p>}
        </div>
      )}
    </li>
  );
}
