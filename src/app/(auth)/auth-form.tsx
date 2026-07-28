"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AuthFormState } from "./actions";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  // useFormStatus must be read from a child of <form>, not the form itself.
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" size="lg" loading={pending} className="w-full">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: "login" | "signup";
  action: (state: AuthFormState, formData: FormData) => Promise<AuthFormState>;
  next?: string;
}) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(action, {});
  const isSignup = mode === "signup";

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-danger-500/30 bg-danger-100 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-danger-700 dark:bg-danger-700/20 dark:text-danger-100"
        >
          {state.error}
        </div>
      )}

      {isSignup && (
        <Field
          label="Workspace name"
          htmlFor="workspaceName"
          required
          hint="Your company or team. You can change it later."
          error={state.fieldErrors?.workspaceName}
        >
          <Input
            name="workspaceName"
            autoComplete="organization"
            placeholder="Acme Support"
            required
          />
        </Field>
      )}

      <Field
        label="Work email"
        htmlFor="email"
        required
        error={state.fieldErrors?.email}
      >
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          autoFocus={!isSignup}
          required
        />
      </Field>

      <Field
        label="Password"
        htmlFor="password"
        required
        hint={isSignup ? "At least 8 characters." : undefined}
        error={state.fieldErrors?.password}
      >
        <Input
          name="password"
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          placeholder="••••••••"
          required
        />
      </Field>

      <SubmitButton
        label={isSignup ? "Create workspace" : "Sign in"}
        pendingLabel={isSignup ? "Creating…" : "Signing in…"}
      />
    </form>
  );
}
