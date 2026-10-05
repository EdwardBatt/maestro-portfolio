-- SJ-v3-S2 (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep) — the client's answer to a reduced
-- scope is recorded on the job.
--
-- The frame: a due date short of the deliverable type's lead time is NOT A BLOCK — *"it goes out
-- tagged Reduced scope, and Ahmed signs that he knows. The signature is recorded on the job. When
-- the date moves later, this is what the conversation refers back to."* Edward, 22 Sep, option (a):
-- **the account manager records the client's answer on the job — an interim measure until the
-- client portal (M10) is in place.** No client login, no email link: the AM asks outside Maestro
-- (the 10 Sep rule for confirmations) and writes down who answered, how, when, and what they said.
--
-- One row per job (unique on campaign_id — the latest answer is the answer), on exactly the
-- `campaign_brief_receipts` shape and policies: readable across the tenant, written by whoever
-- captures the request (`projects:manage`, 20260915120000). The screenshot, if any, files into the
-- job's References like the receipt's and is referenced here.

begin;

create table scope_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  campaign_id     uuid not null unique references campaigns(id) on delete cascade,
  -- What was acknowledged: the arithmetic S2 showed, kept so the conversation can refer back to it.
  needs_days      integer not null check (needs_days > 0),
  has_days        integer not null check (has_days >= 0),
  -- The client's side: who answered (a name, as "who asked" is), how, and when they did.
  acknowledged_by text not null,
  acknowledged_via text not null check (acknowledged_via in ('whatsapp', 'email', 'phone', 'meeting', 'internal', 'other')),
  acknowledged_at timestamptz not null,
  note            text,
  asset_id        uuid references assets(id) on delete set null,
  -- Our side: who wrote it down, and when.
  recorded_by     uuid not null references user_profiles(id),
  recorded_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_scope_acknowledgements_tenant_id on scope_acknowledgements (tenant_id);

comment on table scope_acknowledgements is
  'SJ-v3-S2 (22 Sep): the client''s answer to a reduced scope, recorded on the job by the account '
  'manager — who answered, how, when, what they said. Interim until the client portal (M10) '
  'captures it from the client directly. One per job; the latest answer replaces the earlier.';

alter table scope_acknowledgements enable row level security;
alter table scope_acknowledgements force row level security;

create policy scope_acknowledgements_tenant_select on scope_acknowledgements
  for select using (tenant_id = app.current_tenant_id());

-- Whoever captures a request captures all of it (20260915120000): the same grant as the receipt.
create policy scope_acknowledgements_capture_write on scope_acknowledgements
  for all
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));

create trigger set_updated_at before update on scope_acknowledgements
  for each row execute function app.set_updated_at();

-- AGENTS.md §6: every tenant-scoped table is logged.
create trigger audit_row_change
  after insert or update or delete on scope_acknowledgements
  for each row execute function app.audit_row_change();

commit;
