-- ===========================================================================
-- 0008 — Analytics index
-- ===========================================================================
-- Every function in 0007_analytics.sql filters on exactly
-- `workspace_id = ws and created_at >= now() - interval`, and none of the
-- existing indexes on conversations cover created_at at all — the closest
-- is conversations_inbox (workspace_id, status, last_message_at desc), which
-- doesn't help a predicate on a different column. Without this, every
-- dashboard load is a full scan of the table filtered down after the fact,
-- which is fine at the row counts this project runs today and increasingly
-- is not as a workspace's history grows. This one index turns all four
-- analytics functions into a range scan bounded by the window size instead
-- — the proportional fix at the scale this app is actually likely to hit; a
-- full pg_cron daily-rollup system was considered and set aside as
-- premature (real added operational complexity — a cron dependency, a
-- second table, a hybrid rollup+live-today read path — for a problem this
-- index already solves well past the point a single workspace's aggregate
-- queries would plausibly matter).
-- ===========================================================================

create index if not exists conversations_workspace_created
  on conversations (workspace_id, created_at);
