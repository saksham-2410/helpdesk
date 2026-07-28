"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { OnboardingState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
      {pending ? "Creating…" : "Create workspace"}
    </Button>
  );
}

export function OnboardingForm({
  action,
}: {
  action: (state: OnboardingState, formData: FormData) => Promise<OnboardingState>;
}) {
  const [state, formAction] = useActionState<OnboardingState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-danger-500/30 bg-danger-100 px-3.5 py-2.5 text-[0.8125rem] text-danger-700 dark:bg-danger-700/20 dark:text-danger-100"
        >
          {state.error}
        </div>
      )}
      <Field label="Workspace name" htmlFor="workspaceName" required>
        <Input name="workspaceName" placeholder="Acme Support" autoFocus required />
      </Field>
      <Submit />
    </form>
  );
}
