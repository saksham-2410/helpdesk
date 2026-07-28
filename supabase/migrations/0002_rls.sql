-- ===========================================================================
-- 0002 — Row Level Security
-- ===========================================================================
-- Tenant isolation is enforced in the database, not the application layer.
-- A forgotten `.eq('workspace_id', …)` in a query is then a bug that returns
-- nothing, rather than a bug that leaks another tenant's inbox.
--
-- Two roles matter:
--   authenticated — agents and admins. Constrained by the policies below.
--   service_role  — server-only key used by widget + webhook routes, which act
--                   for anonymous visitors who have no Supabase identity.
--                   It bypasses RLS, so every route using it MUST scope by
--                   workspace_id explicitly. It is never sent to the browser.
-- ===========================================================================

-- --- Helpers ---------------------------------------------------------------
-- SECURITY DEFINER is load-bearing. A policy on workspace_members that itself
-- selects from workspace_members recurses infinitely; running the lookup as
-- the table owner (who bypasses RLS) breaks the cycle. search_path is pinned
-- so the function cannot be hijacked by a caller-controlled schema.

create or replace function public.current_workspace_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select workspace_id
  from public.workspace_members
  where user_id = (select auth.uid());
$$;

create or replace function public.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = ws
      and user_id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.current_workspace_ids() from public;
revoke all on function public.is_workspace_admin(uuid) from public;
grant execute on function public.current_workspace_ids() to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;

-- --- Enable ----------------------------------------------------------------
alter table workspaces            enable row level security;
alter table workspace_members     enable row level security;
alter table invites               enable row level security;
alter table contacts              enable row level security;
alter table conversations         enable row level security;
alter table messages              enable row level security;
alter table conversation_summaries enable row level security;
alter table kb_categories         enable row level security;
alter table kb_articles           enable row level security;
alter table workspace_domains     enable row level security;
alter table canned_responses      enable row level security;

-- ===========================================================================
-- Workspaces
-- ===========================================================================
create policy workspaces_select on workspaces
  for select to authenticated
  using (id in (select current_workspace_ids()));

create policy workspaces_update on workspaces
  for update to authenticated
  using (is_workspace_admin(id))
  with check (is_workspace_admin(id));

-- Creation happens through create_workspace_for_user() (SECURITY DEFINER, in
-- 0003) so that workspace + membership are written atomically. There is
-- deliberately no direct insert policy: a workspace without an admin member
-- is unreachable, and this makes that state unrepresentable.

-- ===========================================================================
-- Membership and invites
-- ===========================================================================
create policy members_select on workspace_members
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy members_admin_write on workspace_members
  for all to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

create policy invites_admin_all on invites
  for all to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- ===========================================================================
-- Tenant data — uniform shape
-- ===========================================================================
create policy contacts_member_all on contacts
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy conversations_member_all on conversations
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy messages_member_all on messages
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy summaries_member_all on conversation_summaries
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy canned_member_all on canned_responses
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

-- ===========================================================================
-- Knowledge base
-- ===========================================================================
-- Agents get full control of their own workspace's articles.
create policy kb_categories_member_all on kb_categories
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

create policy kb_articles_member_all on kb_articles
  for all to authenticated
  using (workspace_id in (select current_workspace_ids()))
  with check (workspace_id in (select current_workspace_ids()));

-- Published articles are public by definition — that is the entire point of a
-- help centre. Exposing them through a policy rather than a service-role route
-- means the public KB and the widget's article suggestions never need a
-- privileged key. Drafts stay invisible.
create policy kb_articles_public_read on kb_articles
  for select to anon, authenticated
  using (status = 'published');

create policy kb_categories_public_read on kb_categories
  for select to anon, authenticated
  using (true);

-- Needed to resolve /help/<slug> and to brand the widget. Only non-sensitive
-- columns exist on this table; membership and conversations are unaffected.
create policy workspaces_public_read on workspaces
  for select to anon
  using (true);

-- ===========================================================================
-- Custom domains — admin-only
-- ===========================================================================
create policy domains_select on workspace_domains
  for select to authenticated
  using (workspace_id in (select current_workspace_ids()));

create policy domains_admin_write on workspace_domains
  for all to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- Host-header lookup happens in proxy.ts before any session exists, so an
-- anonymous read of the domain -> workspace mapping is required. The mapping
-- is public information: anyone can resolve the DNS record anyway.
create policy domains_public_read on workspace_domains
  for select to anon
  using (status = 'active');
