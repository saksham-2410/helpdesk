-- ===========================================================================
-- 0004 — Fix public-read policies to cover authenticated users too
-- ===========================================================================
-- workspaces_public_read and domains_public_read were scoped `to anon` only.
-- Postgres RLS evaluates policies against the CURRENT role, and a signed-in
-- request runs as `authenticated`, not `anon` — a policy restricted to `anon`
-- grants nothing to it. The `workspaces_select` policy only covers a user's
-- OWN workspaces (via workspace_members), so an authenticated agent browsing
-- to /demo, a public KB page, or another workspace's help center — all of
-- which must work for ANY visitor, signed in or not — would silently see no
-- rows and the page would break specifically for people who are logged in.
--
-- kb_articles_public_read and kb_categories_public_read already got this
-- right (`to anon, authenticated`); this migration brings the other two
-- public-read policies in line with that same shape.
-- ===========================================================================

drop policy if exists workspaces_public_read on workspaces;
create policy workspaces_public_read on workspaces
  for select to anon, authenticated
  using (true);

drop policy if exists domains_public_read on workspace_domains;
create policy domains_public_read on workspace_domains
  for select to anon, authenticated
  using (status = 'active');
