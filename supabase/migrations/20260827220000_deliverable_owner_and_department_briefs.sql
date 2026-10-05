-- ADR-0050: a brief belongs to a DEPARTMENT, and a deliverable has an OWNER.
--
-- Supersedes the discipline-shaped half of ADR-0048. The organising unit is not the seeded
-- `work_types` list — which in a real agency is the wrong SHAPE, not merely the wrong names
-- (Edward's "Social & Content" is a team inside Creative, not a sibling of it). It is the
-- person the Account Manager makes accountable, and the department they belong to.
--
-- Nothing here touches roles, permissions, grants or scope. Cross-department sub-task
-- assignment works exactly as it did: a sub-task carries its OWN department and team, derived
-- from its assignee, and never inherits them from its deliverable (ADR-0050 d.9).

-- ---------------------------------------------------------------- the owner ----

alter table deliverables
  add column if not exists owner_user_id uuid references user_profiles(id),
  add column if not exists department_id uuid references departments(id);

comment on column deliverables.owner_user_id is
  'ADR-0050 d.1: the person accountable for this deliverable, set by the Account Manager. The '
  'model never proposes it - accountability is a management decision, not an inference.';
comment on column deliverables.department_id is
  'ADR-0050 d.2: DERIVED from the owner, never asked for. Naming an owner answers which '
  'department the work belongs to; asking both invites them to disagree.';

create index if not exists idx_deliverables_owner on deliverables (owner_user_id)
  where owner_user_id is not null;
create index if not exists idx_deliverables_department on deliverables (tenant_id, department_id)
  where department_id is not null;

-- Derive-don't-ask, the same shape `sub_tasks` already uses. A caller may set the owner; the
-- department follows. Setting them to disagree is not refused with an error, it is simply
-- impossible: the trigger always wins.
create or replace function app.tg_deliverable_stamp_department() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.owner_user_id is null then
    new.department_id := null;
  else
    select p.department_id into new.department_id
      from user_profiles p where p.id = new.owner_user_id;
  end if;
  return new;
end $$;

comment on function app.tg_deliverable_stamp_department() is
  'ADR-0050 d.2: a deliverable''s department comes from its owner. Clearing the owner clears the '
  'department, so the pair can never be half-set.';

create trigger deliverable_stamp_department
  before insert or update of owner_user_id on deliverables
  for each row execute function app.tg_deliverable_stamp_department();

-- ---------------------------------------------------------------- the brief ----

create table campaign_briefs (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  campaign_id   uuid not null references campaigns(id) on delete cascade,
  department_id uuid not null references departments(id),
  -- Which template this department's brief follows. Chosen by the Account Manager (d.4), not
  -- derived: a shoot needs the Production brief and a month of posts needs the Social brief,
  -- and only a person looking at the work can tell which.
  brief_type    text not null,
  -- key -> value, as generated and then edited. `N/A` means considered-and-irrelevant;
  -- absent means not written yet (ADR-0048 d.6).
  values        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- ONE brief per department per campaign (d.3). Six deliverables owned by three people in one
  -- department is one brief listing all six.
  constraint uq_campaign_briefs_campaign_department unique (campaign_id, department_id),
  constraint chk_campaign_briefs_values_object check (jsonb_typeof(values) = 'object')
);

create index idx_campaign_briefs_tenant_id on campaign_briefs (tenant_id);
create index idx_campaign_briefs_campaign on campaign_briefs (campaign_id);

comment on table campaign_briefs is
  'ADR-0050 d.3: one brief per department per campaign. Not per discipline (that list is not '
  'anybody''s organisation) and not per deliverable (six documents for one person is worse than '
  'one imperfect document).';

alter table campaign_briefs enable row level security;
alter table campaign_briefs force row level security;

-- Everyone in the tenant reads: a brief exists to be read by the people doing the work, and
-- narrowing it to the owning department would hide the campaign from the account team.
create policy campaign_briefs_tenant_select on campaign_briefs
  for select using (tenant_id = app.current_tenant_id());

-- Written by whoever may plan campaigns — the same grant the wizard itself requires.
create policy campaign_briefs_manage_insert on campaign_briefs
  for insert with check (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );

create policy campaign_briefs_manage_update on campaign_briefs
  for update using (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  ) with check (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );

create policy campaign_briefs_manage_delete on campaign_briefs
  for delete using (
    tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage')
  );

create trigger set_updated_at before update on campaign_briefs
  for each row execute function app.set_updated_at();
