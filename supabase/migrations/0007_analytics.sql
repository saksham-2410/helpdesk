-- ===========================================================================
-- Analytics — response times, resolution rate, channel split, per-agent load
-- ===========================================================================
-- conversations already carries everything needed (see 0001's comment:
-- "Denormalised for SLA reporting") — these are plain aggregate queries,
-- not new tracking. Three of the four functions are ordinary `stable` SQL
-- functions with no SECURITY DEFINER: they only touch `conversations`,
-- which the caller's own session can already read under
-- `conversations_member_all`, so RLS enforces the workspace scope for free.
-- Only the per-agent breakdown needs SECURITY DEFINER, the same way
-- list_workspace_members (0005) does, because it joins auth.users to
-- resolve an agent's email — exactly that one join, guarded the same way.

create or replace function analytics_overview(ws uuid, days int default 30)
returns table (
  total_conversations        bigint,
  open_count                 bigint,
  resolved_count             bigint,
  snoozed_count               bigint,
  avg_first_response_minutes numeric,
  avg_resolution_minutes     numeric,
  resolution_rate            numeric
)
language sql
stable
as $$
  select
    count(*)::bigint as total_conversations,
    count(*) filter (where status = 'open')::bigint as open_count,
    count(*) filter (where status = 'resolved')::bigint as resolved_count,
    count(*) filter (where status = 'snoozed')::bigint as snoozed_count,
    avg(extract(epoch from (first_response_at - created_at)) / 60)
      filter (where first_response_at is not null) as avg_first_response_minutes,
    avg(extract(epoch from (resolved_at - created_at)) / 60)
      filter (where resolved_at is not null) as avg_resolution_minutes,
    round(
      (count(*) filter (where status = 'resolved'))::numeric
        / nullif(count(*), 0),
      3
    ) as resolution_rate
  from conversations
  where workspace_id = ws
    and created_at >= now() - (days || ' days')::interval;
$$;

grant execute on function analytics_overview(uuid, int) to authenticated;

create or replace function analytics_by_channel(ws uuid, days int default 30)
returns table (
  channel        conversation_channel,
  total          bigint,
  resolved_count bigint
)
language sql
stable
as $$
  select
    channel,
    count(*)::bigint as total,
    count(*) filter (where status = 'resolved')::bigint as resolved_count
  from conversations
  where workspace_id = ws
    and created_at >= now() - (days || ' days')::interval
  group by channel;
$$;

grant execute on function analytics_by_channel(uuid, int) to authenticated;

-- Hour-of-day distribution (UTC — there's no per-workspace timezone setting
-- yet, so this is the honest unit rather than a false-precision local time).
create or replace function analytics_by_hour(ws uuid, days int default 30)
returns table (
  hour_of_day int,
  total       bigint
)
language sql
stable
as $$
  select
    extract(hour from created_at at time zone 'utc')::int as hour_of_day,
    count(*)::bigint as total
  from conversations
  where workspace_id = ws
    and created_at >= now() - (days || ' days')::interval
  group by hour_of_day
  order by hour_of_day;
$$;

grant execute on function analytics_by_hour(uuid, int) to authenticated;

create or replace function analytics_by_agent(ws uuid, days int default 30)
returns table (
  user_id                 uuid,
  email                   citext,
  assigned_count          bigint,
  resolved_count          bigint,
  avg_resolution_minutes  numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.assignee_id as user_id,
    u.email::citext as email,
    count(*)::bigint as assigned_count,
    count(*) filter (where c.status = 'resolved')::bigint as resolved_count,
    avg(extract(epoch from (c.resolved_at - c.created_at)) / 60)
      filter (where c.resolved_at is not null) as avg_resolution_minutes
  from conversations c
  join auth.users u on u.id = c.assignee_id
  where c.workspace_id = ws
    and ws in (select current_workspace_ids())
    and c.assignee_id is not null
    and c.created_at >= now() - (days || ' days')::interval
  group by c.assignee_id, u.email
  order by assigned_count desc;
$$;

grant execute on function analytics_by_agent(uuid, int) to authenticated;
