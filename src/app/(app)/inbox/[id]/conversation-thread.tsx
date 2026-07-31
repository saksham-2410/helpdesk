"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea, Select, Input } from "@/components/ui/field";
import { Avatar, ChannelBadge, StatusPill } from "@/components/ui/badge";
import { compactRelativeTime, contactDisplayName } from "@/lib/inbox/format";
import type { ConversationDetail, Message, WorkspaceMemberOption } from "@/lib/inbox/types";
import type { CannedResponse } from "@/lib/canned/types";
import { SummaryPanel } from "./summary-panel";
import {
  assignConversation,
  setConversationStatus,
  snoozeConversation,
  sendChatReplyAction,
  sendEmailReplyAction,
  markConversationRead,
  sendTypingSignal,
  updateContactName,
  type ActionState,
} from "../actions";

const TYPING_STOP_DELAY_MS = 2000;

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
  cannedResponses,
  aiEnabled,
}: {
  conversation: ConversationDetail;
  initialMessages: Message[];
  members: WorkspaceMemberOption[];
  currentUserId: string;
  cannedResponses: CannedResponse[];
  aiEnabled: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(conversation.status);
  const [assigneeId, setAssigneeId] = useState(conversation.assignee_id);
  const [visitorTyping, setVisitorTyping] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void markConversationRead(conversation.id);
  }, [conversation.id]);

  useEffect(() => {
    const supabase = createBrowserSupabase();
    // Its own channel, not shared with the conv:<id> broadcast topic below
    // — that topic is also joined by the widget's anonymous client with a
    // different config (broadcast+presence only, no postgres_changes).
    // Distinct concerns get distinct topics on principle, even though
    // testing traced an actual live-update gap to the Realtime publication
    // itself rather than to topic sharing (see project notes).
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
    const supabase = createBrowserSupabase();
    // Topic MUST be exactly `conv:<id>` — this is the same broadcast topic
    // the widget (src/widget/realtime.ts) and the server's broadcast()
    // helper (lib/widget/realtime.ts) target for typing/read events.
    // Broadcast-only: see the comment above on why this stays split from
    // the postgres_changes channel.
    const channel = supabase
      .channel(`conv:${conversation.id}`)
      .on("broadcast", { event: "typing" }, ({ payload }: { payload: { from: "visitor" | "agent"; typing: boolean } }) => {
        if (payload.from === "visitor") setVisitorTyping(payload.typing);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      setVisitorTyping(false);
    };
  }, [conversation.id]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages.length, visitorTyping]);

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

      <div className="mx-auto w-full max-w-2xl px-6 pt-4">
        <SummaryPanel conversationId={conversation.id} messageCount={messages.length} />
      </div>

      <div ref={bodyRef} className="flex-1 overflow-y-auto bg-canvas px-6 py-5">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} currentUserId={currentUserId} members={members} />
          ))}
          {visitorTyping && <TypingRow />}
        </div>
      </div>

      <Composer conversation={conversation} cannedResponses={cannedResponses} aiEnabled={aiEnabled} />
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
          {conversation.contact ? (
            <ContactNameField contact={conversation.contact} />
          ) : (
            <p className="truncate text-sm font-medium">Unknown</p>
          )}
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
              className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm border border-border-default bg-surface px-2.5 text-[0.8125rem] font-medium shadow-low transition-colors hover:bg-surface-emphasis active:translate-y-px aria-disabled:pointer-events-none aria-disabled:opacity-45"
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
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-surface-emphasis"
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

/**
 * Chat visitors who skip (or predate) the widget's pre-chat form show up as
 * "Unknown" — clicking the name lets an agent set it once they learn it,
 * rather than leaving the conversation stuck unidentified forever.
 */
function ContactNameField({
  contact,
}: {
  contact: { id: string; name: string | null; email: string | null };
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(contact.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEditing() {
    setValue(contact.name ?? "");
    setError(null);
    setEditing(true);
  }

  function save() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Name is required.");
      return;
    }
    startTransition(async () => {
      const result = await updateContactName(contact.id, trimmed);
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          disabled={pending}
          maxLength={120}
          className="!h-6 w-40 px-1.5 text-sm"
        />
        <Button type="button" size="sm" variant="ghost" className="!h-6 !px-1.5" disabled={pending} onClick={save}>
          Save
        </Button>
        {error && <span className="text-machine text-danger-text">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to set this contact's name"
      className="truncate text-left text-sm font-medium hover:underline"
    >
      {contactDisplayName(contact)}
    </button>
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

function TypingRow() {
  return (
    <div className="flex gap-2.5">
      <Avatar size="sm" className="mt-0.5 shrink-0" />
      <div className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-3.5 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 rounded-full bg-muted"
            style={{ animation: "typing-bounce 1.1s infinite ease-in-out", animationDelay: `${i * 0.12}s` }}
          />
        ))}
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

/** Matches when the ENTIRE draft is "/" plus letters/numbers/hyphens — a
 *  canned response starts a reply, it doesn't insert mid-sentence, so
 *  matching only from the start keeps this unambiguous. */
const CANNED_TRIGGER = /^\/([a-z0-9-]*)$/i;

function Composer({
  conversation,
  cannedResponses,
  aiEnabled,
}: {
  conversation: ConversationDetail;
  cannedResponses: CannedResponse[];
  aiEnabled: boolean;
}) {
  const action = conversation.channel === "email" ? sendEmailReplyAction : sendChatReplyAction;
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Typing signal is chat-only — an email reply has no live recipient on the
  // other end to show it to. Mirrors the widget's own send/debounce shape
  // (src/widget/index.ts) so both sides behave the same way.
  const isChat = conversation.channel === "chat";
  const typingActive = useRef(false);
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cannedQuery, setCannedQuery] = useState<string | null>(null);

  const cannedMatches =
    cannedQuery !== null
      ? cannedResponses
          .filter((r) => r.shortcut.startsWith(cannedQuery.toLowerCase()))
          .slice(0, 6)
      : [];

  function stopTypingSignal() {
    if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
    typingStopTimer.current = undefined;
    if (typingActive.current) {
      typingActive.current = false;
      void sendTypingSignal(conversation.id, false);
    }
  }

  function insertCanned(response: CannedResponse) {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = response.body_text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    setCannedQuery(null);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function insertDraft(text: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  const [state, formAction] = useActionState<ActionState, FormData>(async (_prev, formData) => {
    if (isChat) stopTypingSignal();
    const result = await action(conversation.id, formData);
    if (!result.error) formRef.current?.reset();
    return result;
  }, {});

  useEffect(() => {
    return () => stopTypingSignal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only, not a reactive effect
  }, []);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="relative border-t border-border-subtle bg-surface px-5 py-3.5"
    >
      {cannedQuery !== null && cannedMatches.length > 0 && (
        <ul className="absolute inset-x-5 bottom-full z-10 mb-1.5 overflow-hidden rounded-md border border-border-default bg-surface-raised py-1 shadow-mid">
          {cannedMatches.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => insertCanned(r)}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-surface-emphasis"
              >
                <span className="text-machine !text-accent">/{r.shortcut}</span>
                <span className="truncate text-[0.8125rem]">{r.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {aiEnabled && (
        <div className="mb-2">
          <SuggestReplyButton conversationId={conversation.id} onDraft={insertDraft} />
        </div>
      )}

      <div className="flex items-end gap-2.5">
        <Textarea
          ref={textareaRef}
          name="text"
          placeholder={
            conversation.channel === "email"
              ? "Write an email reply… (try /shortcut)"
              : "Write a message… (try /shortcut)"
          }
          required
          className="min-h-[44px]"
          onChange={(e) => {
            const match = e.target.value.match(CANNED_TRIGGER);
            setCannedQuery(match ? match[1] : null);

            if (!isChat) return;
            if (!typingActive.current) {
              typingActive.current = true;
              void sendTypingSignal(conversation.id, true);
            }
            if (typingStopTimer.current) clearTimeout(typingStopTimer.current);
            typingStopTimer.current = setTimeout(stopTypingSignal, TYPING_STOP_DELAY_MS);
          }}
          onKeyDown={(e) => {
            if (cannedQuery !== null && cannedMatches.length > 0) {
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                insertCanned(cannedMatches[0]!);
                return;
              }
              if (e.key === "Escape") {
                setCannedQuery(null);
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <SendButton />
      </div>
      {state.error && (
        <p className="absolute -top-5 left-5 text-xs text-danger-500">{state.error}</p>
      )}
    </form>
  );
}

function SuggestReplyButton({
  conversationId,
  onDraft,
}: {
  conversationId: string;
  onDraft: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/draft-reply`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        // "unavailable" (no AI key) fails the same as any other error here —
        // the button stays visible either way since aiEnabled already
        // reflects server config, so reaching this case means something
        // else went wrong (timeout, quota, malformed response).
        setError(data.error ?? "Could not generate a draft.");
      } else {
        onDraft(data.draft);
      }
    } catch {
      setError("Could not generate a draft.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative inline-block">
      <Button type="button" variant="subtle" size="sm" loading={loading} onClick={handleClick}>
        <SparkleIcon />
        {loading ? "Drafting…" : "Suggest reply"}
      </Button>
      {error && (
        <p className="absolute left-0 top-full z-10 mt-1 w-64 text-xs text-danger-500">{error}</p>
      )}
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="size-3.5" aria-hidden>
      <path
        d="M8 2.5c.3 1.7 1 2.9 2.1 3.6.9.6 2 .9 3.4 1-1.4.1-2.5.4-3.4 1C9 8.8 8.3 10 8 11.7c-.3-1.7-1-2.9-2.1-3.6-.9-.6-2-.9-3.4-1 1.4-.1 2.5-.4 3.4-1C6.9 5.4 7.6 4.2 8 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
