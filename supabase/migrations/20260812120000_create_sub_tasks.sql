-- ADR-0010: sub_tasks — the unit that splits a (single) deliverable's work across
-- teams/members. Assignee + SLA hours/dates + status; deliverable SLA rolls up from
-- these; capacity-consuming and calendar-visible (scheduler integration is separate).
-- ADR-0009: Account-Manager assignment lives on clients (default) and campaigns (override).
-- Tenant-scoped reads here; scoped WRITE policy + helpers are the companion migration.

-- Account Manager assignment (ADR-0009): default per account, override per campaign.
alter table clients   add column account_manager_id uuid references user_profiles(id);
alter table campaigns add column account_manager_id uuid references user_profiles(id);
create index idx_clients_account_manager on clients (account_manager_id);
create index idx_campaigns_account_manager on campaigns (account_manager_id);
comment on column clients.account_manager_id is 'Default Account Manager for this client/account (ADR-0009).';
comment on column campaigns.account_manager_id is 'Per-campaign Account Manager override; falls back to the client''s AM (ADR-0009).';

create table sub_tasks (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  department_id  uuid references departments(id),     -- department the work is directed at
  team_id        uuid references teams(id),           -- team the work is directed at
  assignee_id    uuid references user_profiles(id),   -- the team member doing it (nullable until assigned)
  title          text not null,
  description    text,
  sla_hours      numeric(6,2) check (sla_hours is null or sla_hours > 0),
  starts_at      timestamptz,
  due_at         timestamptz,
  status         text not null default 'todo'
                   check (status in ('todo','in_progress','blocked','review','done','cancelled')),
  created_by     uuid references user_profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_sub_tasks_tenant_id on sub_tasks (tenant_id);
create index idx_sub_tasks_deliverable_id on sub_tasks (deliverable_id);
create index idx_sub_tasks_team_id on sub_tasks (team_id);
create index idx_sub_tasks_department_id on sub_tasks (department_id);
create index idx_sub_tasks_assignee_id on sub_tasks (assignee_id);

alter table sub_tasks enable row level security;
alter table sub_tasks force row level security;

-- Reads are tenant-wide (everyone sees the work); writes are scoped in the companion migration.
create policy sub_tasks_tenant_select on sub_tasks
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create trigger set_updated_at before update on sub_tasks
  for each row execute function app.set_updated_at();
create trigger audit_row_change
  after insert or update or delete on sub_tasks
  for each row execute function app.audit_row_change();

comment on table sub_tasks is
  'ADR-0010: work breakdown under a deliverable. Directed at a department/team, assigned to a member, own SLA hours/dates. Deliverable SLA rolls up from these.';
