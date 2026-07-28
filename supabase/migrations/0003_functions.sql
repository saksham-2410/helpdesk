-- ===========================================================================
-- 0003 — Functions and triggers
-- ===========================================================================
-- Invariants that must hold regardless of which code path writes are enforced
-- here rather than in the API layer. The inbound email webhook, the widget
-- route, and the agent composer all insert messages; none of them should have
-- to remember to bump last_message_at.
-- ===========================================================================

-- --- slugify ---------------------------------------------------------------
create or replace function slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ===========================================================================
-- Workspace creation
-- ===========================================================================
-- Atomic by construction: a workspace and its first admin are written in one
-- statement pair inside one function. Doing this from the client would leave a
-- window where a workspace exists with no members — invisible to every RLS
-- policy and therefore unrecoverable without service-role access.
create or replace function create_workspace_for_user(
  workspace_name text,
  desired_slug   text default null
)
returns workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid       uuid := (select auth.uid());
  base_slug text;
  final_slug text;
  suffix    int := 0;
  ws        workspaces;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  base_slug := slugify(coalesce(nullif(trim(desired_slug), ''), workspace_name));
  if base_slug is null or length(base_slug) < 2 then
    base_slug := 'workspace';
  end if;
  base_slug := left(base_slug, 32);

  -- Resolve collisions rather than failing: signup must not dead-end because
  -- someone already took "acme".
  final_slug := base_slug;
  loop
    exit when not exists (select 1 from workspaces w where w.slug = final_slug);
    suffix := suffix + 1;
    final_slug := left(base_slug, 32) || '-' || suffix::text;
  end loop;

  insert into workspaces (name, slug)
  values (trim(workspace_name), final_slug)
  returning * into ws;

  insert into workspace_members (workspace_id, user_id, role)
  values (ws.id, uid, 'admin');

  return ws;
end;
$$;

grant execute on function create_workspace_for_user(text, text) to authenticated;

-- ===========================================================================
-- Invite acceptance
-- ===========================================================================
-- SECURITY DEFINER because the invitee is, by definition, not yet a member and
-- so cannot see the invites row under RLS. The token is the authorisation, and
-- it is checked against the caller's own verified email so a leaked token
-- cannot be redeemed by a third party.
create or replace function accept_invite(invite_token text)
returns workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid        uuid := (select auth.uid());
  user_email citext;
  inv        invites;
  ws         workspaces;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select email into user_email from auth.users where id = uid;

  select * into inv from invites
  where token = invite_token
    and accepted_at is null
    and expires_at > now();

  -- NOT FOUND rather than `inv is null`: a composite is only IS NULL when every
  -- field is null, which an all-null row would also satisfy.
  if not found then
    raise exception 'invite is invalid or has expired' using errcode = 'P0002';
  end if;

  if inv.email is distinct from user_email then
    raise exception 'this invite was issued to a different email address'
      using errcode = '42501';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (inv.workspace_id, uid, inv.role)
  on conflict (workspace_id, user_id) do update set role = excluded.role;

  update invites set accepted_at = now() where id = inv.id;

  select * into ws from workspaces where id = inv.workspace_id;
  return ws;
end;
$$;

grant execute on function accept_invite(text) to authenticated;

-- ===========================================================================
-- Conversation bookkeeping
-- ===========================================================================
-- Runs for every message regardless of channel or writer.
create or replace function on_message_insert()
returns trigger
language plpgsql
as $$
begin
  update conversations c
  set
    last_message_at = greatest(c.last_message_at, new.created_at),

    -- First agent reply stamps the SLA clock exactly once.
    first_response_at = case
      when c.first_response_at is null and new.author_type = 'agent'
        then new.created_at
      else c.first_response_at
    end,

    -- A customer writing back reopens the conversation. Without this, a
    -- resolved thread silently swallows follow-ups — the single most common
    -- way a support inbox loses a customer.
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

create trigger messages_after_insert
  after insert on messages
  for each row execute function on_message_insert();

-- Keep resolved_at consistent with status changes made directly by an agent.
create or replace function on_conversation_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now();
    new.snoozed_until := null;
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;

  if new.status <> 'snoozed' then
    new.snoozed_until := null;
  end if;

  return new;
end;
$$;

create trigger conversations_status_change
  before update of status on conversations
  for each row execute function on_conversation_status_change();

-- ===========================================================================
-- Snooze wake-up
-- ===========================================================================
-- Called opportunistically when the inbox is read, so the feature works
-- without a scheduler. If pg_cron is available this is also safe to schedule.
create or replace function wake_due_snoozed_conversations(ws uuid default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer;
begin
  update conversations
  set status = 'open', snoozed_until = null
  where status = 'snoozed'
    and snoozed_until is not null
    and snoozed_until <= now()
    and (ws is null or workspace_id = ws);

  get diagnostics touched = row_count;
  return touched;
end;
$$;

grant execute on function wake_due_snoozed_conversations(uuid) to authenticated;

-- ===========================================================================
-- Knowledge base search
-- ===========================================================================
-- websearch_to_tsquery handles quoted phrases and OR/- operators the way a
-- user expects from a search box, and never throws on malformed input the way
-- to_tsquery does. Exposed as RPC so both the public KB page and the widget's
-- suggestion endpoint share exactly one ranking implementation.
create or replace function search_kb_articles(
  ws           uuid,
  query        text,
  result_limit int default 5
)
returns table (
  id       uuid,
  title    text,
  slug     citext,
  excerpt  text,
  rank     real
)
language sql
stable
as $$
  select a.id, a.title, a.slug, a.excerpt,
         ts_rank(a.search_vector, websearch_to_tsquery('english', query)) as rank
  from kb_articles a
  where a.workspace_id = ws
    and a.status = 'published'
    and length(trim(coalesce(query, ''))) > 1
    and a.search_vector @@ websearch_to_tsquery('english', query)
  order by rank desc, a.updated_at desc
  limit least(greatest(result_limit, 1), 20);
$$;

grant execute on function search_kb_articles(uuid, text, int) to anon, authenticated;
