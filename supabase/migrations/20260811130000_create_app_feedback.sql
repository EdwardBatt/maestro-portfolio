-- Product feedback (alpha launch). Any signed-in tenant user can submit a
-- feedback item about the app as themselves; only admins holding
-- `admin.feedback:view` can read submissions (deny-by-default, ADR-0008).
-- Universal audit trigger captures every write. Surfaces: an alpha badge +
-- "Send feedback" dialog on every page, and a Power-Admin feedback screen.
-- [alpha-feedback]

create type feedback_category as enum ('bug', 'idea', 'other');

create table app_feedback (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  submitted_by  uuid not null references user_profiles(id),
  category      feedback_category not null default 'other',
  message       text not null,
  page_path     text,
  app_version   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint chk_app_feedback_message_len check (char_length(btrim(message)) between 1 and 4000)
);

create index idx_app_feedback_tenant_id on app_feedback (tenant_id);
create index idx_app_feedback_created_at on app_feedback (created_at);

alter table app_feedback enable row level security;
alter table app_feedback force row level security;

-- Submit: any authenticated user, own tenant, as themselves (actor pinned like
-- sla_events — the client cannot attribute feedback to someone else).
create policy app_feedback_tenant_insert on app_feedback
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and submitted_by = auth.uid());

-- Read: an admin ability. Power Admin holds admin.feedback:view automatically
-- (ADR-0008 catalog-insert trigger); no other role does unless granted.
create policy app_feedback_admin_select on app_feedback
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('admin.feedback', 'view'));

-- Rows are mutable (future triage fields) — maintain updated_at.
create trigger set_updated_at before update on app_feedback
  for each row execute function app.set_updated_at();

-- Universal audit (ADR-0008 Decision 8): capture direct PostgREST writes.
create trigger audit_row_change
  after insert or update or delete on app_feedback
  for each row execute function app.audit_row_change();
