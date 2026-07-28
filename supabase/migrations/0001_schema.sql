-- ===========================================================================
-- 0001 — Core schema
-- ===========================================================================
-- Every tenant-scoped table carries workspace_id. That is deliberate
-- denormalisation: it lets one RLS policy shape apply uniformly and keeps
-- tenant filters on an indexed column rather than behind a join. Tenant
-- isolation you have to re-derive per table is tenant isolation you will
-- eventually get wrong.
-- ===========================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;     -- case-insensitive email

-- --- Enums -----------------------------------------------------------------
-- Enums over check constraints: they are self-documenting in the generated
-- TypeScript types and reject bad writes at the database rather than the API.
create type workspace_role       as enum ('admin', 'agent');
create type conversation_channel as enum ('chat', 'email');
create type conversation_status  as enum ('open', 'snoozed', 'resolved');
create type message_author_type  as enum ('contact', 'agent', 'system');
create type article_status       as enum ('draft', 'published');
create type domain_status        as enum ('pending', 'verifying', 'active', 'failed');

-- --- updated_at ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ===========================================================================
-- Workspaces and membership
-- ===========================================================================

create table workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) between 1 and 80),
  slug        citext not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$'),
  -- Widget appearance, greeting copy, allowed embed origins.
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger workspaces_updated_at before update on workspaces
  for each row execute function set_updated_at();

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         workspace_role not null default 'agent',
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

create table invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        citext not null,
  role         workspace_role not null default 'agent',
  -- Random, unguessable, and the only credential needed to accept. Hashing it
  -- would be better still; noted as a known limitation rather than pretended.
  token        text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by   uuid references auth.users(id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  accepted_at  timestamptz,
  created_at   timestamptz not null default now()
);
-- One live invite per email per workspace; re-inviting replaces rather than
-- accumulating duplicates.
create unique index invites_pending_unique
  on invites (workspace_id, email) where accepted_at is null;

-- ===========================================================================
-- Contacts — the end users writing in
-- ===========================================================================

create table contacts (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  email         citext,
  name          text,
  -- Stable id the widget stores in localStorage, so an anonymous visitor is
  -- recognised across sessions before they ever give an email address.
  visitor_id    text,
  last_seen_at  timestamptz,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger contacts_updated_at before update on contacts
  for each row execute function set_updated_at();

-- A contact is identified by email OR visitor_id; both are unique per
-- workspace when present, neither is required.
create unique index contacts_workspace_email  on contacts (workspace_id, email)      where email is not null;
create unique index contacts_workspace_visitor on contacts (workspace_id, visitor_id) where visitor_id is not null;

-- ===========================================================================
-- Conversations
-- ===========================================================================

create table conversations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  contact_id        uuid not null references contacts(id) on delete cascade,
  channel           conversation_channel not null,
  status            conversation_status  not null default 'open',
  assignee_id       uuid references auth.users(id) on delete set null,
  subject           text,

  -- Threading fallback layer 2. Real mail clients strip In-Reply-To and
  -- References often enough that header matching alone loses replies, so we
  -- also send from support+<token>@domain and match on the way back in.
  email_token       text not null unique default encode(gen_random_bytes(9), 'hex'),

  snoozed_until     timestamptz,
  -- Denormalised for SLA reporting and the inbox sort, which would otherwise
  -- need an aggregate over messages on every list render.
  first_response_at timestamptz,
  resolved_at       timestamptz,
  last_message_at   timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint snoozed_requires_until
    check (status <> 'snoozed' or snoozed_until is not null)
);
create trigger conversations_updated_at before update on conversations
  for each row execute function set_updated_at();

-- The inbox's primary query: workspace + filters, newest activity first.
create index conversations_inbox
  on conversations (workspace_id, status, last_message_at desc);
create index conversations_assignee
  on conversations (workspace_id, assignee_id, last_message_at desc);
create index conversations_contact on conversations (contact_id);
-- Partial index for the snooze sweeper: only rows that can actually wake up.
create index conversations_due_snooze
  on conversations (snoozed_until) where status = 'snoozed';

-- ===========================================================================
-- Messages
-- ===========================================================================

create table messages (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references workspaces(id) on delete cascade,
  conversation_id  uuid not null references conversations(id) on delete cascade,
  author_type      message_author_type not null,
  -- auth.users.id for agents; null for contacts and system notes.
  author_user_id   uuid references auth.users(id) on delete set null,

  body_html        text,
  body_text        text not null default '',

  -- Threading layer 1. RFC 5322 identifiers, stored for inbound and outbound
  -- alike so the next reply in either direction can be resolved.
  email_message_id text,
  in_reply_to      text,
  refs             text[],

  created_at       timestamptz not null default now()
);

create index messages_conversation on messages (conversation_id, created_at);
-- Idempotency for the inbound webhook: Resend retries, and a retry must not
-- create a duplicate message.
create unique index messages_email_message_id
  on messages (email_message_id) where email_message_id is not null;
-- Reverse lookup when an inbound reply cites a Message-ID we sent.
create index messages_in_reply_to on messages (in_reply_to) where in_reply_to is not null;

-- ===========================================================================
-- AI summaries
-- ===========================================================================

create table conversation_summaries (
  conversation_id   uuid primary key references conversations(id) on delete cascade,
  workspace_id      uuid not null references workspaces(id) on delete cascade,
  summary           jsonb not null,
  -- The cache key. A summary is valid only up to the message it last saw; a
  -- newer message invalidates it and we extend rather than regenerate.
  up_to_message_id  uuid references messages(id) on delete set null,
  model             text,
  generated_at      timestamptz not null default now()
);

-- ===========================================================================
-- Knowledge base
-- ===========================================================================

create table kb_categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 80),
  slug         citext not null,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table kb_articles (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  category_id  uuid references kb_categories(id) on delete set null,
  title        text not null check (length(trim(title)) between 1 and 200),
  slug         citext not null,
  -- Sanitised at render, never trusted from the database. See lib/sanitize.
  body_html    text not null default '',
  -- Plain-text mirror: powers full-text search and gives the AI reply-drafting
  -- prompt clean input without HTML noise.
  body_text    text not null default '',
  excerpt      text,
  status       article_status not null default 'draft',
  author_id    uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, slug),

  -- Weighted so a title match outranks a body match. Generated rather than
  -- trigger-maintained: it cannot drift out of sync with the content.
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(excerpt, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(body_text, '')), 'C')
  ) stored
);
create trigger kb_articles_updated_at before update on kb_articles
  for each row execute function set_updated_at();

create index kb_articles_search on kb_articles using gin (search_vector);
create index kb_articles_published
  on kb_articles (workspace_id, status, updated_at desc);

-- ===========================================================================
-- Custom domains
-- ===========================================================================

create table workspace_domains (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references workspaces(id) on delete cascade,
  -- Globally unique: one hostname cannot resolve to two tenants.
  domain        citext not null unique,
  status        domain_status not null default 'pending',
  -- Verification instructions from Vercel, shown to the tenant as DNS records.
  verification  jsonb not null default '[]'::jsonb,
  last_error    text,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger workspace_domains_updated_at before update on workspace_domains
  for each row execute function set_updated_at();
create index workspace_domains_workspace on workspace_domains (workspace_id);

-- ===========================================================================
-- Canned responses (Phase B)
-- ===========================================================================

create table canned_responses (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title        text not null check (length(trim(title)) between 1 and 120),
  -- Typed as "/refund" in the composer.
  shortcut     citext not null,
  body_html    text not null default '',
  body_text    text not null default '',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, shortcut)
);
create trigger canned_responses_updated_at before update on canned_responses
  for each row execute function set_updated_at();
