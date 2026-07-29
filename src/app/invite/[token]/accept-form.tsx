"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { acceptInvite, type AcceptState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}

export function AcceptForm({ token }: { token: string }) {
  // A <form action> always invokes with (state, FormData) regardless of
  // whether the handler needs the form data — accepted and ignored here
  // since this form has no fields, just a submit button.
  const [state, formAction] = useActionState<AcceptState, FormData>(
    async () => acceptInvite(token),
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-danger-500/30 bg-danger-100 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-danger-700 dark:bg-danger-700/20 dark:text-danger-100"
        >
          {state.error}
        </div>
      )}
      <Submit />
    </form>
  );
}
