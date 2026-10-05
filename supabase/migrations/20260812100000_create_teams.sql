-- Teams: an org layer inside Departments (Department -> Team -> people), plus
-- team membership on profiles. One team per person (user_profiles.team_id).
-- Writes gated by organization:manage, mirroring departments/offices; tenant-
-- scoped RLS; universal audit + updated_at triggers (new tables opt in, per the
-- app_feedback precedent — the 20260802103000 attach loop is a fixed list).

create table teams (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  department_id uuid not null references departments(id) on delete cascade,
  name          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint uq_teams_department_name unique (department_id, name)
);
create index idx_teams_tenant_id on teams (tenant_id);
create index idx_teams_department_id on teams (department_id);

alter table teams enable row level security;
alter table teams force row level security;

create policy teams_tenant_select on teams
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy teams_admin_write on teams
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on teams
  for each row execute function app.set_updated_at();

create trigger audit_row_change
  after insert or update or delete on teams
  for each row execute function app.audit_row_change();

-- One team per person; nullable (not everyone is on a team). Deleting a team
-- (or its department, which cascades) unassigns members rather than blocking.
alter table user_profiles
  add column team_id uuid references teams(id) on delete set null;
create index idx_user_profiles_team_id on user_profiles (team_id);

comment on column user_profiles.team_id is
  'Team membership (one per person). Team belongs to a Department; org chart is Department -> Team -> people. ADR-0008.';

-- Resources carry team (they already carry department) so scheduling writes can
-- be scoped to a Department Lead's department or a Team Leader's team. Reads stay
-- tenant-wide; only write policies consult this (companion migration).
alter table resources
  add column team_id uuid references teams(id) on delete set null;
create index idx_resources_team_id on resources (team_id);

comment on column resources.team_id is
  'Optional team a resource belongs to; with department_id it drives write-scope for scoped lead roles (ADR-0008).';
