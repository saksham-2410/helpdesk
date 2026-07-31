-- ===========================================================================
-- 0009 — Broadcast-based realtime for the inbox list
-- ===========================================================================
-- The inbox list pane (every agent, every conversation in the workspace)
-- subscribed to postgres_changes on `conversations`. That fan-out pattern
-- costs O(agents x message rate): Realtime re-evaluates RLS once per
-- subscriber for every single change, not once per change — the busier a
-- shared inbox gets, the more that multiplies, and it's the first thing to
-- fall over under real concurrent agent load. The per-thread message view
-- (conversation-thread.tsx, topic `thread:<id>`) is NOT changed here — only
-- one or two agents are ever looking at one specific conversation at a time,
-- so that fan-out was never the problem.
--
-- realtime.broadcast_changes(), called from a trigger, evaluates
-- authorization ONCE at subscribe time (via RLS on realtime.messages) rather
-- than once per subscriber per row change — the same event data, delivered
-- the cheaper way. Broadcast channels used this way are PRIVATE by
-- construction (Realtime Authorization), which is what the policy below
-- grants: only actual members of a workspace can receive its topic, not
-- "anyone who knows the UUID" the way the widget's own (deliberately
-- lower-trust, documented-tradeoff) broadcast channel works for anonymous
-- visitors.
-- ===========================================================================

create or replace function public.broadcast_conversation_change()
returns trigger
security definer
set search_path = public, pg_temp
language plpgsql
as $$
begin
  perform realtime.broadcast_changes(
    'inbox:' || coalesce(new.workspace_id, old.workspace_id)::text, -- topic
    tg_op,                                                          -- event
    tg_op,                                                          -- operation
    tg_table_name,                                                  -- table
    tg_table_schema,                                                -- schema
    new,
    old
  );
  return null;
end;
$$;

create trigger conversations_broadcast
after insert or update or delete on conversations
for each row execute function public.broadcast_conversation_change();

-- Only a member of the workspace encoded in the topic name may receive its
-- broadcasts — the actual security boundary, not "the topic is hard to
-- guess". Scoped to the broadcast extension specifically so this policy
-- can't be misread as granting anything about presence or postgres_changes
-- traffic on this same system table.
create policy "workspace members receive their inbox broadcasts"
on "realtime"."messages"
for select
to authenticated
using (
  exists (
    select 1 from workspace_members
    where user_id = (select auth.uid())
      and concat('inbox:', workspace_id) = (select realtime.topic())
      and realtime.messages.extension = 'broadcast'
  )
);

-- conversations no longer needs postgres_changes now that the list pane
-- reads its updates from the broadcast trigger above — leaving it in the
-- publication would just be paying its replication overhead for a feature
-- nothing subscribes to anymore. messages stays: the per-thread view still
-- uses postgres_changes there, and that fan-out was never the problem this
-- migration addresses.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime drop table conversations;
  end if;
end $$;
