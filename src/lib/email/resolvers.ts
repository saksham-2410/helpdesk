import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ThreadResolvers } from "./threading";
import { normalizeSubject } from "./threading";

/**
 * Database-backed implementation of the pure `ThreadResolvers` interface
 * from threading.ts, using the service-role client (the inbound webhook has
 * no user session to act as). Kept separate from threading.ts so the
 * matching STRATEGY stays unit-testable without a database, while this file
 * is the (thin, mostly untested-by-unit-test) glue to Postgres.
 */
export function createDbThreadResolvers(db: SupabaseClient): ThreadResolvers {
  return {
    async byMessageIds(ids) {
      if (ids.length === 0) return null;
      const { data } = await db
        .from("messages")
        .select("conversation_id, email_message_id, created_at")
        .in("email_message_id", ids)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!data) return null;
      return { conversationId: data.conversation_id, messageId: data.email_message_id! };
    },

    async byToken(token) {
      const { data } = await db
        .from("conversations")
        .select("id")
        .eq("email_token", token)
        .maybeSingle();
      return data?.id ?? null;
    },

    async bySubject({ fromEmail, normalizedSubject, withinHours }) {
      // conversations.subject is stored raw (as the customer wrote it), not
      // normalized, and there are few enough candidates per sender to
      // normalize in application code rather than add a generated column
      // just for this last-resort, low-confidence layer.
      const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString();

      const { data: contact } = await db
        .from("contacts")
        .select("id")
        .eq("email", fromEmail)
        .maybeSingle();
      if (!contact) return null;

      const { data: candidates } = await db
        .from("conversations")
        .select("id, subject")
        .eq("contact_id", contact.id)
        .eq("channel", "email")
        .gte("last_message_at", since)
        .order("last_message_at", { ascending: false })
        .limit(5);

      const match = (candidates ?? []).find(
        (c) => normalizeSubject(c.subject) === normalizedSubject,
      );
      return match?.id ?? null;
    },
  };
}
