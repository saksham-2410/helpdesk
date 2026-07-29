-- ===========================================================================
-- 0005 — Team management RPCs
-- ===========================================================================
-- auth.users is not exposed through the normal PostgREST/RLS surface, so a
-- member directory needs a SECURITY DEFINER function to join against it
-- safely — consistent with how 0003 already handles workspace creation and
-- invite acceptance. Two invariants are enforced here that were implicit
-- before: a workspace can never end up with zero admins (locked out of its
-- own settings), and only an admin can change membership at all.
-- ===========================================================================

-- ===========================================================================
-- Member directory
-- ===========================================================================
-- The caller-membership check is folded into the WHERE clause rather than an
-- explicit exception: if `ws` isn't among the caller's own workspaces, the
-- join predicate is false for every row and the result is simply empty. That
-- reveals nothing about whether the workspace exists, which a raised
-- exception with a distinct error would.
create or replace function list_workspace_members(ws uuid)
returns table (
  user_id    uuid,
  email      citext,
  role       workspace_role,
  joined_at  timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.user_id, u.email::citext, m.role, m.created_at
  from workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = ws
    and ws in (select current_workspace_ids())
  order by m.created_at asc;
$$;

grant execute on function list_workspace_members(uuid) to authenticated;

-- ===========================================================================
-- Remove a member
-- ===========================================================================
create or replace function remove_workspace_member(ws uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role   workspace_role;
  admin_count   int;
begin
  if not is_workspace_admin(ws) then
    raise exception 'only an admin can remove a team member' using errcode = '42501';
  end if;

  select role into target_role
  from workspace_members
  where workspace_id = ws and user_id = target_user_id;

  if not found then
    raise exception 'that person is not a member of this workspace' using errcode = 'P0002';
  end if;

  if target_role = 'admin' then
    select count(*) into admin_count
    from workspace_members
    where workspace_id = ws and role = 'admin';

    if admin_count <= 1 then
      raise exception 'a workspace must keep at least one admin' using errcode = '23514';
    end if;
  end if;

  delete from workspace_members
  where workspace_id = ws and user_id = target_user_id;
end;
$$;

grant execute on function remove_workspace_member(uuid, uuid) to authenticated;

-- ===========================================================================
-- Change a member's role
-- ===========================================================================
create or replace function update_workspace_member_role(
  ws uuid,
  target_user_id uuid,
  new_role workspace_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_role  workspace_role;
  admin_count  int;
begin
  if not is_workspace_admin(ws) then
    raise exception 'only an admin can change a team member''s role' using errcode = '42501';
  end if;

  select role into target_role
  from workspace_members
  where workspace_id = ws and user_id = target_user_id;

  if not found then
    raise exception 'that person is not a member of this workspace' using errcode = 'P0002';
  end if;

  -- Demoting the last admin would strand the workspace with no one able to
  -- manage it — including undoing this exact change.
  if target_role = 'admin' and new_role <> 'admin' then
    select count(*) into admin_count
    from workspace_members
    where workspace_id = ws and role = 'admin';

    if admin_count <= 1 then
      raise exception 'a workspace must keep at least one admin' using errcode = '23514';
    end if;
  end if;

  update workspace_members
  set role = new_role
  where workspace_id = ws and user_id = target_user_id;
end;
$$;

grant execute on function update_workspace_member_role(uuid, uuid, workspace_role) to authenticated;

-- ===========================================================================
-- Invite preview
-- ===========================================================================
-- Reachable by a visitor who is, by definition, not yet a member of the
-- workspace they're being invited to — `invites_admin_all` correctly denies
-- them a read. The token itself is the credential (a long random value,
-- unguessable) and is what actually authorizes this: possessing it is enough
-- to preview the invite's target and status, before or without an account.
-- accept_invite (0003) still requires a signed-in session whose verified
-- email matches; this is read-only and never mutates anything.
create or replace function get_invite_preview(invite_token text)
returns table (
  workspace_name text,
  email          citext,
  role           workspace_role,
  expires_at     timestamptz,
  is_valid       boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select w.name, i.email, i.role, i.expires_at,
         (i.accepted_at is null and i.expires_at > now()) as is_valid
  from invites i
  join workspaces w on w.id = i.workspace_id
  where i.token = invite_token;
$$;

grant execute on function get_invite_preview(text) to anon, authenticated;
