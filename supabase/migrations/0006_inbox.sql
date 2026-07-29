-- ===========================================================================
-- 0006 — Unified inbox support
-- ===========================================================================
-- Two things the inbox needs that nothing so far has required:
--
-- 1. A denormalized last-message preview on conversations. The list view
--    renders one row per conversation showing who's assigned, its status,
--    and a snippet of the last message — without this, that snippet means
--    either an N+1 query per row or a join against the largest table in the
--    schema on every list render. One more column, maintained by the same
--    trigger that already updates last_message_at, is cheap.
--
-- 2. Enabling the Realtime publication on conversations and messages. RLS
--    on these tables was already correct from day one, but Realtime's
--    postgres_changes feature is a SEPARATE opt-in on top of RLS — a table
--    can have perfect RLS and still emit zero change events until it's
--    added to the supabase_realtime publication. This is what lets the
--    agent side of the inbox update live via an authenticated, RLS-scoped
--    subscription — the counterpart to the widget's manual broadcast
--    channel, which exists specifically because an anonymous visitor has no
--    RLS-visible session to subscribe under.
-- ===========================================================================

alter table conversations add column if not exists last_message_preview text;

create or replace function on_message_insert()
returns trigger
language plpgsql
as $$
begin
  update conversations c
  set
    last_message_at = greatest(c.last_message_at, new.created_at),
    -- Plain-text, truncated: the list view is not the place to render HTML,
    -- and a long email body would otherwise dominate the row.
    last_message_preview = left(coalesce(new.body_text, ''), 200),

    first_response_at = case
      when c.first_response_at is null and new.author_type = 'agent'
        then new.created_at
      else c.first_response_at
    end,

    status = case
      when new.author_type = 'contact' and c.status in ('resolved', 'snoozed')
        then 'open'::conversation_status
      else c.status
    end,

    snoozed_until = case
      when new.author_type = 'contact' and c.status = 'snoozed' then null
      else c.snoozed_until
    end,

    resolved_at = case
      when new.author_type = 'contact' and c.status = 'resolved' then null
      else c.resolved_at
    end
  where c.id = new.conversation_id;

  return new;
end;
$$;

-- Realtime: opt these two tables into the publication. Idempotent — adding a
-- table already in the publication would error without the guard, and this
-- migration may run against a database where it was added manually via the
-- dashboard first.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
