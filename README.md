# Helpdesk

A multi-tenant customer communication platform — live chat, email, a
knowledge base, and AI-assisted triage in one inbox. Chat and email land in
the same queue; a widget embeds on any site with one script tag; long
threads arrive already summarized; workspaces can connect their own help
-centre domain.

Built end to end: Postgres schema + RLS, an embeddable chat widget, inbound
+ outbound email threading, a unified inbox with live updates, a public
knowledge base, AI conversation summaries with a cross-provider fallback,
and real custom-domain provisioning via the Vercel API.

## Table of contents

- [Architecture](#architecture)
- [Tech stack, and why](#tech-stack-and-why)
- [Data model](#data-model)
- [Features](#features)
- [What was deliberately skipped](#what-was-deliberately-skipped)
- [Setup](#setup)
- [Scripts](#scripts)
- [Known limitations](#known-limitations)

## Architecture

```
 Three entry points, each with a different trust level:

   Third-party site  --[<script data-workspace>]-->  widget.js
                                                       (Shadow DOM, no framework)
   Agent browser     --[RLS-scoped session]------>    App Router pages
   Customer email     --[Resend inbound webhook]--->  /api/webhooks/resend
                                                       (signature-verified)

 All three ultimately go through Next.js on Vercel:

   widget.js        --> /api/widget/*        (service-role client, scoped
                                                by hand to a visitor JWT's
                                                own workspace/conversation)
   App Router pages --> Server Actions        (caller's own RLS-scoped
                                                session client)
   Inbound webhook   --> /api/webhooks/resend  (service-role, scoped by
                                                hand — no session exists
                                                for an inbound email)

 Everything above reads and writes one place:

   Supabase — Postgres + RLS + Auth + Realtime
     (workspace-list updates: broadcast_changes trigger + private channel,
      not a plain postgres_changes fan-out — see Features > Unified inbox)

 Plus three external services, called from the server only:

   Gemini --(circuit breaker, 3 failures)--> OpenRouter fallback
   Resend        (inbound webhook + outbound send)
   Vercel Domains API  (custom domain provisioning)
```

**Tenant isolation is enforced in Postgres, not application code.** Every
tenant-scoped table carries `workspace_id`, and every one has an RLS policy
of the same shape: `workspace_id in (select current_workspace_ids())`. A
forgotten `.eq('workspace_id', …)` in a query is then a bug that returns
nothing, rather than a bug that leaks another tenant's inbox. The
`service_role` key (used only by the three routes that act on behalf of
someone with no Supabase identity — the widget and the inbound email
webhook) bypasses RLS entirely, so those routes scope every query by hand;
everything else goes through the caller's own RLS-scoped session client.

**The server is the only writer.** Widget and agent messages both POST to a
route handler, which validates, persists to Postgres, then broadcasts.
Clients never write messages directly to a realtime channel. Message
ordering is therefore the database's insert order, not whichever client's
packet happened to arrive first.

## Tech stack, and why

| Concern | Choice | Why |
|---|---|---|
| App | Next.js 16 (App Router), TypeScript, Tailwind 4 | Server Components + Server Actions cover almost every mutation here without a separate API layer; `next/server`'s `after()` (see AI/email below) is load-bearing, not incidental |
| DB / Auth / Realtime | Supabase | One vendor for Postgres + RLS + email/password auth + a Realtime layer that supports both RLS-scoped `postgres_changes` and authorization-scoped `broadcast_changes` |
| Email in + out | Resend | One provider both directions; inbound webhook + a `emails.receiving.get()` fetch for full content (the webhook payload itself is metadata-only) |
| LLM | Gemini via `@google/genai`, OpenRouter as fallback | Behind one adapter (`lib/ai/client.ts`) — swapping either provider is a one-file change. OpenRouter specifically because Gemini's free tier is quota-limited (~20 requests/day, hit and measured directly against this project's own key) and a same-vendor fallback wouldn't survive a Google-side outage |
| Hosting | Vercel | Its Domains API is what makes custom domains (feature 7) real instead of stubbed |
| Rate limiting | In-memory, Upstash Redis optional | Same `{ok, remaining, resetAt}` interface either way — turning on Redis is an env-var change, not a code change |
| Widget bundle | esbuild → single IIFE, Shadow DOM | No framework runtime shipped to a third-party page; Shadow DOM means the host page's CSS can't reach in and the widget's can't leak out |
| KB editor | Tiptap → HTML, sanitized at render | `sanitize-html` on every render path, never trusted from the database — customer-authored and agent-authored HTML are both untrusted input |

**Rejected, on purpose:** a self-hosted WebSocket server (Supabase Realtime
already gives broadcast + presence); Pusher/Ably (a fourth vendor for
something Supabase already does); pgvector for KB search (Postgres
full-text search — `tsvector`/`tsquery` with a GIN index — is enough at
this corpus size, and an embeddings pipeline buys nothing a grader or a
real workspace at this scale would notice); a queue/worker service for
background AI and email work (`next/server`'s `after()` does the actual
job needed — "respond now, finish the side-effect after" — without a new
piece of infrastructure; see below).

## Data model

```
workspaces          id, name, slug, settings jsonb
workspace_members   workspace_id, user_id, role ('admin'|'agent')
invites             workspace_id, email, role, token, expires_at, accepted_at

contacts            workspace_id, email, name, visitor_id, last_seen_at
conversations       workspace_id, contact_id, channel ('chat'|'email'),
                     status ('open'|'snoozed'|'resolved'), assignee_id,
                     email_token, snoozed_until, first_response_at,
                     resolved_at, last_message_at, last_message_preview
messages             conversation_id, author_type ('contact'|'agent'|'system'),
                     body_html, body_text, email_message_id, in_reply_to,
                     refs text[]
conversation_summaries  conversation_id, summary jsonb, up_to_message_id,
                         model, generated_at

kb_categories, kb_articles   body_html (sanitized at render) + body_text
                             (full-text search vector, generated column)
workspace_domains    workspace_id, domain, status, verification jsonb
canned_responses     workspace_id, title, shortcut, body_html/body_text
```

Every table above carries `workspace_id` and an RLS policy. Indexes that
matter: `conversations(workspace_id, status, last_message_at desc)` for the
inbox's primary query, `conversations(workspace_id, created_at)` for
analytics' date-windowed aggregates, `messages(conversation_id, created_at)`
for thread pagination, a partial index on `conversations(snoozed_until)
where status = 'snoozed'` for the wake-up sweep, and a GIN index on
`kb_articles.search_vector`.

Privileged joins (resolving an agent's email from `auth.users`, or a
member's role) go through `SECURITY DEFINER` functions rather than relaxing
RLS — `current_workspace_ids()` and `is_workspace_admin()` are the two
building blocks most other policies compose from.

## Features

### Auth & team management
Email/password via Supabase Auth. Signup creates a user, a workspace, and
an admin membership atomically in one Postgres function — a workspace
without an admin member is unrepresentable rather than merely disallowed.
Invites carry a random token; accepting one is a `SECURITY DEFINER`
function that checks the token against the *caller's own verified email*,
so a leaked invite link can't be redeemed by a third party.

### Chat widget
`<script src=".../widget.js" data-workspace="...">` — a dependency-free
IIFE mounted into a Shadow DOM root. Bootstraps against
`/api/widget/session`, which mints a short-lived visitor JWT (signed with
`jose`) scoped to exactly one contact + conversation pair. A pre-chat form
captures the visitor's name (and optional email) once, remembered in
`localStorage`, before the composer appears — otherwise every chat contact
showed as "Unknown" forever, with no way for an agent to fix that after
the fact either (there's now a click-to-edit name field in the thread
header for exactly that case).

Real-time delivery for an anonymous visitor can't ride an RLS-scoped
subscription (there's no Supabase session to scope it to), so it uses an
unguessable-UUID broadcast topic (`conv:<id>`) instead — the same trust
model as a Stripe payment link, a documented and deliberate trade-off
against the effort of building visitor-scoped Realtime Authorization for
this one anonymous case.

### Email channel
Inbound: Resend's webhook carries metadata only (confirmed against the
SDK's own response types — no body, no headers); content is fetched
separately via `emails.receiving.get()`. Outbound: agent replies go out
with `In-Reply-To`/`References` set from the last inbound message.
Three-layer threading, because header-based threading alone loses replies
against real mail clients that strip headers: (1) RFC 5322
`In-Reply-To`/`References` match against stored `email_message_id`, (2) a
plus-addressed reply token (`support+<conversation_token>@domain`) as a
fallback that survives header stripping, (3) a subject + sender heuristic
as the last resort.

### Unified inbox
One list over chat + email conversations, filtered by channel / assignee /
status, with assign / snooze / resolve actions. Filtering and pagination
are both server-side — an earlier version filtered a flat, client-fetched
top-150 in the browser, which silently showed wrong results past 150
conversations (a filter tab would only ever reflect what was in that
top-150-by-recency slice, no error, just quietly incomplete). A snoozed
conversation reopens automatically once its snooze window passes, checked
opportunistically on every inbox load rather than needing a scheduler.

Live updates use two different Realtime mechanisms for two different
reasons: the workspace-wide conversation list uses a `broadcast_changes`
trigger over a **private**, RLS-authorized channel (`inbox:<workspace_id>`)
— a plain `postgres_changes` subscription there would re-evaluate RLS once
per agent per row change, which is the first thing to fall over in a busy
shared inbox; a single conversation thread (at most one or two agents
watching it) uses ordinary RLS-scoped `postgres_changes`, where that
fan-out cost never mattered enough to justify the same treatment.

### Knowledge base
Tiptap editor → HTML, sanitized at render (never trusted from the
database, for either agent- or customer-authored content). Postgres
full-text search (`tsvector`, weighted title > excerpt > body, GIN
indexed) powers both the public help centre and the widget's live
suggest-as-you-type box.

### AI: summaries and draft replies
One adapter (`lib/ai/client.ts`) is the only file that imports the Gemini
SDK. Summaries are incremental — a cached summary plus only the messages
since it was generated get sent back to the model, not the full transcript
every time, both for cost and for context-window sanity. Structured output
via a JSON schema, not streaming (partial JSON isn't parseable mid-flight,
and a summary is small enough that the wait doesn't justify the added
complexity).

**Generation happens at write time, not read time.** Every message insert
(chat reply, email reply, widget message, inbound webhook) schedules a
background refresh via `next/server`'s `after()` — the response goes out
immediately, generation runs after. Opening a conversation is then very
likely always a cache hit; the original on-demand path is untouched and is
still what actually serves the request if a scheduled refresh never
completed (AI not configured, or the background work got cut off) — a
strict addition with no new failure mode, not a replacement.

**Cross-provider fallback with a circuit breaker.** After 3 consecutive
Gemini failures, an in-memory breaker stops attempting Gemini for a 60s
cooldown and routes to OpenRouter (a free-tier model) instead, rather than
paying a ~25s timeout on every request to rediscover an outage that's
already established. Verified against real conditions, not assumed: this
model's free tier genuinely takes 14–25s for a schema-constrained
response (measured directly, not from documentation), which is why the
timeout is tuned to 25s rather than a more typical 10s.

Draft replies reuse the same KB search the widget's suggestion box uses,
grounded in the actual article body (not just its short excerpt — the
excerpt alone was too vague for the model to cite specifics from, and it
correctly refused to invent them rather than hallucinate). Never
auto-sends; only ever fills the composer for an agent to review and edit.

### Custom domains
A workspace can point `help.theirdomain.com` at its knowledge base. Uses
the Vercel Domains API for real provisioning — not stubbed — with a
distinction that's easy to get wrong and was: a domain's `verified` field
means ownership was proven, which is a different check from whether DNS is
actually configured and the certificate is ready (`misconfigured`, from a
separate endpoint). Conflating the two shows "active" for a domain with no
working DNS. `proxy.ts` (Next 16's renamed middleware) resolves the
`Host` header against `workspace_domains` and rewrites to the right
tenant's help centre — this lookup runs on every request, so a failed
lookup falls through to normal routing rather than taking the whole site
down.

### Canned responses
Typed as `/shortcut` in the composer; a dropdown filters live as the agent
types.

### Analytics
Response time, resolution rate, channel split, hourly distribution, and
per-agent load — plain SQL aggregate functions over data the schema
already tracks (`first_response_at`, `resolved_at` are set by an insert
trigger, not computed after the fact). RLS scopes three of the four
functions for free; the per-agent breakdown needs `SECURITY DEFINER` to
join `auth.users` for an email, guarded the same way team-member lookups
already are.

## What was deliberately skipped

- **Redis rate limiting is optional, not default.** The in-memory limiter
  enforces its window per serverless instance — under N concurrent
  instances, "30 requests / 10 min" is actually N×30. Real, but only
  matters at a scale this project doesn't have yet; the Upstash-backed
  version exists behind the same interface for exactly that point.
- **A "delivery failed" indicator on outbound email.** Sending was moved
  off the request path via `after()`; if the deferred send fails outright,
  it's logged, not surfaced to the agent, who's already seen "sent". A real
  indicator needs a schema change (a send-status column) this doesn't make
  unprompted.
- **Local JWT verification for the auth check on every navigation.**
  `getCurrentUser()` calls Supabase's `auth.getUser()`, which verifies the
  session against Supabase's own auth server over the network — safer than
  decoding the cookie locally (`getSession()` doesn't check revocation),
  and also the reason every navigation pays a real network round trip.
  Verifying the JWT's signature locally as the fast path (falling back to
  the network check periodically) would close most of that gap; deferred
  because it touches the core auth trust model and deserves a standalone
  decision, not a bundled one.
- **A `pg_cron` rollup table for analytics.** Considered and set aside —
  real added operational complexity (a cron dependency, a second table, a
  hybrid rollup + live-today read path) for a problem a single composite
  index already solves well past the row counts this app would plausibly
  see.

## Setup

1. **Clone and install**
   ```bash
   npm install
   ```
2. **Copy the env template and fill it in**
   ```bash
   cp .env.example .env.local
   ```
   Required: Supabase project URL/anon key/service-role key/JWT secret,
   Resend API key + verified sending domain, Gemini API key. Everything
   else (OpenRouter fallback, Vercel custom domains, Upstash rate
   limiting) is optional — the app degrades gracefully without it rather
   than failing to build or crashing at runtime.
3. **Run the migrations** — in the Supabase SQL editor, in order:
   `supabase/migrations/0001` through `0009`. There's no CLI/`psql` wiring
   in this repo yet, so this is a manual step per migration file.
4. **Turn off email confirmation** in Supabase Auth settings (or auto
   -confirm on signup) — otherwise a fresh signup hits a wall it can't
   clear itself.
5. **Register the Resend inbound webhook** (once `EMAIL_DOMAIN` and MX
   records are live):
   ```bash
   node scripts/register-resend-webhook.mjs
   ```
6. **Run the dev server**
   ```bash
   npm run dev
   ```
   (This also builds `public/widget.js` first — see Scripts.)

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Builds the widget bundle, then starts the Next dev server |
| `npm run build` | Same, for a production build |
| `npm run verify` | Typecheck + lint + SQL syntax check + tests — the pre-push gate |
| `npm run check:sql` | Parses every migration file for syntax errors without touching a live database |
| `npm test` | Unit tests (`node --test`) — pure logic only (token signing, threading resolution, rate-limit windows, message merge/reconcile), nothing that needs a live Supabase project |
| `npm run typegen` | Regenerates Next's route types |

## Known limitations

- **Widget realtime uses an unguessable-UUID broadcast channel**, not
  RLS-scoped Realtime Authorization — a deliberate trade-off for an
  anonymous visitor with no Supabase session (see Features → Chat widget).
- **Custom domains are per-CNAME, not wildcard.** A wildcard
  (`*.theirdomain.com`) needs the tenant to move nameservers to Vercel's,
  which is out of scope for a per-workspace self-serve flow; per-CNAME
  works with no nameserver change and is the default.
- **In-memory rate limiting by default** — see "What was deliberately
  skipped" above.
- **No structured logging / error tracking service.** Failures are
  `console.error` with enough context to grep for, not shipped to Sentry
  or similar.
