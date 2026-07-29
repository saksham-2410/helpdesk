"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea, Select } from "@/components/ui/field";
import { Avatar, ChannelBadge, StatusPill } from "@/components/ui/badge";
import { compactRelativeTime, contactDisplayName } from "@/lib/inbox/format";
import type { ConversationDetail, Message, WorkspaceMemberOption } from "@/lib/inbox/types";
import {
  assignConversation,
  setConversationStatus,
  snoozeConversation,
  sendChatReplyAction,
  sendEmailReplyAction,
  markConversationRead,
  type ActionState,
} from "../actions";

/**
 * Message bodies render as plain text (body_text), never body_html, even
 * for email — customer-authored HTML is untrusted input, and the safest
 * amount of sanitization code to get wrong is none. Rendering the HTML
 * version is a reasonable follow-up (behind a real sanitizer, sanitize-html
 * is already a dependency for the knowledge base), deliberately deferred
 * rather than reaching for dangerouslySetInnerHTML here.
 */
export function ConversationThread({
  conversation,
  initialMessages,
  members,
  currentUserId,
}: {
  conversation: ConversationDetail;
  initialMessages: Message[];
  members: WorkspaceMemberOption[];
  currentUserId: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(conversation.status);
  const [assigneeId, setAssigneeId] = useState(conversation.assignee_id);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void markConversationRead(conversation.id);
  }, [conversation.id]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    const channel = supabase
      .channel(`thread:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload: { new: Message }) => {
          const row = payload.new;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
          if (row.author_type === "contact") void markConversationRead(conversation.id);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length]);

  return (
    <>
      <ThreadHeader
        conversation={conversation}
        members={members}
        status={status}
        assigneeId={assigneeId}
        onStatusChange={setStatus}
        onAssigneeChange={setAssigneeId}
      />

      <div ref={bodyRef} className="flex-1 overflow-y-auto bg-canvas px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} currentUserId={currentUserId} members={members} />
          ))}
        </div>
      </div>

      <Composer conversation={conversation} />
    </>
  );
}

function ThreadHeader({
  conversation,
  members,
  status,
  assigneeId,
  onStatusChange,
  onAssigneeChange,
}: {
  conversation: ConversationDetail;
  members: WorkspaceMemberOption[];
  status: ConversationDetail["status"];
  assigneeId: string | null;
  onStatusChange: (s: ConversationDetail["status"]) => void;
  onAssigneeChange: (id: string | null) => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleAssign(value: string) {
    const next = value === "" ? null : value;
    onAssigneeChange(next);
    startTransition(async () => {
      await assignConversation(conversation.id, next);
    });
  }

  function handleResolveToggle() {
    const next = status === "resolved" ? "open" : "resolved";
    onStatusChange(next);
    startTransition(async () => {
      await setConversationStatus(conversation.id, next);
    });
  }

  function handleSnooze(preset: "1h" | "4h" | "tomorrow" | "1w") {
    onStatusChange("snoozed");
    startTransition(async () => {
      await snoozeConversation(conversation.id, preset);
    });
  }

  return (
    <header className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
      <Avatar name={conversation.contact?.name} email={conversation.contact?.email} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <ChannelBadge channel={conversation.channel} />
          <p className="truncate text-sm font-medium">{contactDisplayName(conversation.contact)}</p>
          <StatusPill status={status} />
        </div>
        {conversation.contact?.email && (
          <p className="text-machine">{conversation.contact.email}</p>
        )}
      </div>

      <Select
        aria-label="Assignee"
        value={assigneeId ?? ""}
        disabled={pending}
        onChange={(e) => handleAssign(e.target.value)}
        className="!h-8 w-40 text-xs"
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.user_id} value={m.user_id}>
            {m.email}
          </option>
        ))}
      </Select>

      <div className="relative">
        <details className="group">
          <summary className="list-none">
            <span
              role="button"
              tabIndex={0}
              aria-disabled={pending}
              className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-border-default bg-surface px-2.5 text-[0.8125rem] font-medium shadow-low transition-colors hover:bg-paper-100 active:translate-y-px dark:hover:bg-paper-800 aria-disabled:pointer-events-none aria-disabled:opacity-45"
            >
              Snooze
            </span>
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-32 rounded-md border border-border-default bg-surface-raised py-1 shadow-mid">
            {(
              [
                ["1h", "1 hour"],
                ["4h", "4 hours"],
                ["tomorrow", "Tomorrow"],
                ["1w", "1 week"],
              ] as const
            ).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={(e) => {
                  handleSnooze(preset);
                  e.currentTarget.closest("details")?.removeAttribute("open");
                }}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-paper-100 dark:hover:bg-paper-800"
              >
                {label}
              </button>
            ))}
          </div>
        </details>
      </div>

      <Button
        variant={status === "resolved" ? "secondary" : "primary"}
        size="sm"
        disabled={pending}
        onClick={handleResolveToggle}
      >
        {status === "resolved" ? "Reopen" : "Resolve"}
      </Button>
    </header>
  );
}

function MessageRow({
  message,
  currentUserId,
  members,
}: {
  message: Message;
  currentUserId: string;
  members: WorkspaceMemberOption[];
}) {
  if (message.author_type === "system") {
    return (
      <p className="text-center text-xs text-muted">{message.body_text}</p>
    );
  }

  const isAgent = message.author_type === "agent";
  const author = isAgent
    ? (members.find((m) => m.user_id === message.author_user_id)?.email ??
       (message.author_user_id === currentUserId ? "You" : "Agent"))
    : null;

  return (
    <div className={`flex gap-2.5 ${isAgent ? "flex-row-reverse" : ""}`}>
      <Avatar email={author ?? undefined} name={isAgent ? undefined : undefined} size="sm" className="mt-0.5 shrink-0" />
      <div className={`max-w-[75%] ${isAgent ? "items-end text-right" : ""} flex flex-col`}>
        <div
          className={`whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-sm leading-relaxed ${
            isAgent
              ? "bg-accent text-accent-text"
              : "border border-border-subtle bg-surface"
          }`}
        >
          {message.body_text}
        </div>
        <p className="mt-1 text-machine">
          {isAgent && author ? `${author} · ` : ""}
          {compactRelativeTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

function SendButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" loading={pending} className="self-end">
      {pending ? "Sending…" : "Send"}
    </Button>
  );
}

function Composer({ conversation }: { conversation: ConversationDetail }) {
  const action = conversation.channel === "email" ? sendEmailReplyAction : sendChatReplyAction;
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction] = useActionState<ActionState, FormData>(async (_prev, formData) => {
    const result = await action(conversation.id, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});

  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative flex items-end gap-2.5 border-t border-border-subtle bg-surface px-5 py-3.5"
    >
      <Textarea
        name="text"
        placeholder={
          conversation.channel === "email" ? "Write an email reply…" : "Write a message…"
        }
        required
        className="min-h-[44px]"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <SendButton />
      {state.error && (
        <p className="absolute -top-5 left-5 text-xs text-danger-500">{state.error}</p>
      )}
    </form>
  );
}
