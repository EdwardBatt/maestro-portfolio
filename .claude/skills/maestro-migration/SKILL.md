---
name: maestro-migration
description: Author a Maestro database migration. Use whenever creating or altering tables, enums, constraints, RLS policies, or any supabase/migrations SQL. Enforces tenant_id + RLS-in-same-migration, naming conventions, type regeneration, and the paired pgTAP test.
---

# Writing a Maestro migration

Migrations are SQL files in `supabase/migrations/`, named `YYYYMMDDHHMMSS_verb_noun.sql`,
one concern per file, forward-only (never edit an applied migration — fix forward).
**Never apply migrations to a remote database — Edward runs them.**

## Required shape for any new tenant-scoped table

```sql
create table bookings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  -- domain columns: snake_case; FKs <entity>_id; booleans is_*/has_*;
  -- ALL timestamps timestamptz (naked timestamp is banned)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_bookings_tenant_id on bookings (tenant_id);

-- RLS in the SAME migration — a table without RLS never merges
alter table bookings enable row level security;
alter table bookings force row level security;

create policy bookings_tenant_select on bookings
  for select using (tenant_id = app.current_tenant_id());
-- one policy per verb actually needed; policy naming: <table>_<audience>_<action>
-- audiences: tenant | joint_project | portal | service

-- AUDIT in the SAME migration, for the same reason as RLS: everything is logged
create trigger audit_row_change
  after insert or update or delete on bookings
  for each row execute function app.audit_row_change();
```

Checklist per migration:

1. `tenant_id uuid not null references tenants(id)` on every tenant-scoped table — no exceptions.
2. RLS enabled + forced + policies in the same file. Deny-by-default: create only the
   policies the audience needs. Tenant identity comes from JWT claims, never client params.
3. Enums as Postgres enum types, singular (`booking_state`). Extending an enum is its own migration.
4. Hard invariants live here: e.g. the exclusive-resource overlap ban is an exclusion
   constraint (`create extension if not exists btree_gist;` then
   `exclude using gist (resource_id with =, timespan with &&) where (state = 'confirmed')`),
   not application logic.
5. Append-only tables (SLA events, audit rows): INSERT policy only, plus
   `revoke update, delete on <table> from authenticated, anon;`. Never add UPDATE/DELETE later.
5b. **The audit trigger, in the same file as the table** (AGENTS.md §6). Every tenant-scoped table
   gets `audit_row_change` — pgTAP `092` fails the build on one that does not, and names it. The
   only exemptions are the logs themselves (`audit_events`, `sla_events`) and the content that
   already IS the record (`notifications`, `messages`); a fifth needs an ADR. The first attempt at this was a hand-written list of tables and it went a month out of
   date without anything failing.
6. `security definer` functions: forbidden without an ADR; if authorized, pin `search_path`.
7. Pair every migration with pgTAP coverage in `supabase/tests/` — at minimum one allow and
   one deny test per new policy (see `maestro-rls-testing`).
8. After writing: regenerate types — `npx supabase gen types typescript --local > src/types/database.ts`
   (local only) — and reference the tracker task ID in the proposed commit message.

Schema decisions that change shape (new entity, changed relationship, new state) need an ADR
first (`maestro-adr`).
