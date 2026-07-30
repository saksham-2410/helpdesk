"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import {
  createCannedResponse,
  updateCannedResponse,
  deleteCannedResponse,
  type ActionState,
} from "./canned-actions";
import type { CannedResponse } from "@/lib/canned/types";

function AddSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" loading={pending}>
      Add
    </Button>
  );
}

function AddCannedForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createCannedResponse, {});
  return (
    <form action={formAction} className="grid gap-2.5 sm:grid-cols-[1fr_10rem]">
      <Field label="Title" htmlFor="canned-title">
        <Input id="canned-title" name="title" placeholder="Refund policy" required />
      </Field>
      <Field label="Shortcut" htmlFor="canned-shortcut" hint="Type /shortcut in the composer">
        <Input id="canned-shortcut" name="shortcut" placeholder="refund" required />
      </Field>
      <Field label="Body" htmlFor="canned-body" className="sm:col-span-2">
        <Textarea
          id="canned-body"
          name="bodyText"
          placeholder="Refunds are processed within 5-7 business days..."
          required
          className="min-h-20"
        />
      </Field>
      <div className="sm:col-span-2">
        <AddSubmit />
        {state.error && <p className="mt-1.5 text-xs text-danger-500">{state.error}</p>}
      </div>
    </form>
  );
}

export function CannedSection({ responses }: { responses: CannedResponse[] }) {
  return (
    <section>
      <h2 className="mb-1 text-xl font-semibold">Canned responses</h2>
      <p className="mb-3 text-sm leading-relaxed text-secondary">
        Type <code className="text-machine">/shortcut</code> in the inbox composer to insert one
        instantly — works for both chat and email replies.
      </p>

      <AddCannedForm />

      {responses.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-surface">
          {responses.map((r) => (
            <CannedRow key={r.id} response={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function CannedRow({ response }: { response: CannedResponse }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm(`Delete "${response.title}"?`)) return;
    startTransition(async () => {
      await deleteCannedResponse(response.id);
    });
  }

  async function handleSave(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await updateCannedResponse(response.id, formData);
      if (result.error) setError(result.error);
      else setEditing(false);
    });
  }

  if (editing) {
    return (
      <li className="px-4 py-3.5">
        <form action={handleSave} className="grid gap-2.5 sm:grid-cols-[1fr_10rem]">
          <Field label="Title" htmlFor={`title-${response.id}`}>
            <Input id={`title-${response.id}`} name="title" defaultValue={response.title} required />
          </Field>
          <Field label="Shortcut" htmlFor={`shortcut-${response.id}`}>
            <Input id={`shortcut-${response.id}`} name="shortcut" defaultValue={response.shortcut} required />
          </Field>
          <Field label="Body" htmlFor={`body-${response.id}`} className="sm:col-span-2">
            <Textarea
              id={`body-${response.id}`}
              name="bodyText"
              defaultValue={response.body_text}
              required
              className="min-h-20"
            />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" size="sm" loading={pending}>
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {error && <p className="text-xs text-danger-500">{error}</p>}
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{response.title}</p>
          <Badge tone="neutral">/{response.shortcut}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-secondary">{response.body_text}</p>
      </div>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setEditing(true)}>
        Edit
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={handleDelete}>
        Delete
      </Button>
    </li>
  );
}
