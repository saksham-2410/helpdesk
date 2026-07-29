"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Avatar, Badge } from "@/components/ui/badge";
import {
  createInvite,
  revokeInvite,
  removeMember,
  updateMemberRole,
  type ActionState,
} from "./actions";

export interface Member {
  user_id: string;
  email: string;
  role: "admin" | "agent";
  joined_at: string;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "agent";
  expires_at: string;
}

function InviteSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending}>
      {pending ? "Sending…" : "Send invite"}
    </Button>
  );
}

function InviteForm() {
  const [state, formAction] = useActionState<ActionState, FormData>(createInvite, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <Field label="Email" htmlFor="invite-email" className="min-w-52 flex-1">
        <Input
          id="invite-email"
          name="email"
          type="email"
          placeholder="teammate@company.com"
          required
        />
      </Field>
      <Field label="Role" htmlFor="invite-role" className="w-32">
        <Select id="invite-role" name="role" defaultValue="agent">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </Select>
      </Field>
      <InviteSubmit />
      {state.error && <p className="w-full text-xs text-danger-500">{state.error}</p>}
      {state.notice && <p className="w-full text-xs text-secondary">{state.notice}</p>}
    </form>
  );
}

function MemberRow({
  member,
  isAdmin,
  isSelf,
  isOnlyAdmin,
}: {
  member: Member;
  isAdmin: boolean;
  isSelf: boolean;
  isOnlyAdmin: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleRoleChange(role: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateMemberRole(member.user_id, role);
      if (result.error) setError(result.error);
    });
  }

  function handleRemove() {
    if (!confirm(`Remove ${member.email} from this workspace?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await removeMember(member.user_id);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-0">
      <Avatar email={member.email} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {member.email}
          {isSelf && <span className="ml-1.5 text-xs text-muted">(you)</span>}
        </p>
        {error && <p className="text-xs text-danger-500">{error}</p>}
      </div>

      {isAdmin ? (
        <Select
          aria-label={`Role for ${member.email}`}
          value={member.role}
          disabled={pending || (isOnlyAdmin && member.role === "admin")}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="!h-8 w-28 text-xs"
        >
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </Select>
      ) : (
        <Badge tone={member.role === "admin" ? "accent" : "neutral"}>{member.role}</Badge>
      )}

      {isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending || (isOnlyAdmin && member.role === "admin")}
          onClick={handleRemove}
          title={
            isOnlyAdmin && member.role === "admin"
              ? "A workspace must keep at least one admin"
              : undefined
          }
        >
          Remove
        </Button>
      )}
    </div>
  );
}

function InviteRow({ invite, isAdmin }: { invite: PendingInvite; isAdmin: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-3 border-b border-border-subtle py-3 last:border-0">
      <Avatar email={invite.email} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-secondary">{invite.email}</p>
        <p className="text-machine !text-[0.6875rem]">
          Pending &middot; expires {new Date(invite.expires_at).toLocaleDateString()}
        </p>
      </div>
      <Badge tone={invite.role === "admin" ? "accent" : "neutral"}>{invite.role}</Badge>
      {isAdmin && (
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await revokeInvite(invite.id);
            })
          }
        >
          Revoke
        </Button>
      )}
    </div>
  );
}

export function TeamSection({
  members,
  invites,
  currentUserId,
  isAdmin,
}: {
  members: Member[];
  invites: PendingInvite[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const adminCount = members.filter((m) => m.role === "admin").length;

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="label-eyebrow mb-3">Invite a teammate</p>
          <InviteForm />
        </div>
      )}

      <div className="rounded-lg border border-border-subtle bg-surface p-5">
        <p className="label-eyebrow mb-1">
          Members <span className="text-muted">({members.length})</span>
        </p>
        <div className="mt-2">
          {members.map((m) => (
            <MemberRow
              key={m.user_id}
              member={m}
              isAdmin={isAdmin}
              isSelf={m.user_id === currentUserId}
              isOnlyAdmin={adminCount <= 1}
            />
          ))}
        </div>
      </div>

      {invites.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-surface p-5">
          <p className="label-eyebrow mb-1">
            Pending invites <span className="text-muted">({invites.length})</span>
          </p>
          <div className="mt-2">
            {invites.map((inv) => (
              <InviteRow key={inv.id} invite={inv} isAdmin={isAdmin} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
