-- M1 schema-readiness for M8 (§10.4): joint projects — single nominal host
-- owns configuration (OD 12 resolved), bounded bidirectional visibility.
-- This migration lands the SHAPE (tables + host/invited tenant policies).
-- The two-part cross-tenant RLS ("your rows + granted joint-project rows,
-- per-field, symmetric") is milestone M8 and gets its own migrations plus
-- the disproportionate pgTAP suite — deliberately NOT smuggled in here.

create table joint_projects (
  id                 uuid primary key default gen_random_uuid(),
  campaign_id        uuid not null unique references campaigns(id),
  host_tenant_id     uuid not null references tenants(id),  -- owns config & final say
  invited_tenant_id  uuid not null references tenants(id),
  status             text not null default 'active' check (status in ('active', 'closed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint chk_joint_projects_distinct_tenants
    check (host_tenant_id <> invited_tenant_id)
);
create index idx_joint_projects_host_tenant_id on joint_projects (host_tenant_id);
create index idx_joint_projects_invited_tenant_id on joint_projects (invited_tenant_id);

alter table joint_projects enable row level security;
alter table joint_projects force row level security;

-- Both sides may SEE the joint project row; only the host administers it.
create policy joint_projects_member_select on joint_projects
  for select to authenticated
  using (app.current_tenant_id() in (host_tenant_id, invited_tenant_id));
create policy joint_projects_host_admin_write on joint_projects
  for all to authenticated
  using (host_tenant_id = app.current_tenant_id() and app.is_admin())
  with check (host_tenant_id = app.current_tenant_id() and app.is_admin());

create trigger set_updated_at before update on joint_projects
  for each row execute function app.set_updated_at();

-- Project-scoped grant: collaborator keeps home-tenant identity; home role
-- does NOT carry over (§10.4) — the granted role applies only inside the project.
create table joint_project_grants (
  id                uuid primary key default gen_random_uuid(),
  joint_project_id  uuid not null references joint_projects(id),
  user_id           uuid not null references user_profiles(id),
  user_tenant_id    uuid not null references tenants(id),
  granted_role      text not null check (granted_role in ('viewer', 'contributor', 'scheduler')),
  created_at        timestamptz not null default now(),
  constraint uq_joint_project_grants unique (joint_project_id, user_id)
);
create index idx_joint_project_grants_project on joint_project_grants (joint_project_id);
create index idx_joint_project_grants_user on joint_project_grants (user_id);
create index idx_joint_project_grants_user_tenant on joint_project_grants (user_tenant_id);

alter table joint_project_grants enable row level security;
alter table joint_project_grants force row level security;

-- Members of either side see the grant list for their shared project; only
-- the HOST tenant's admin manages grants (single ownership).
create policy joint_project_grants_member_select on joint_project_grants
  for select to authenticated
  using (exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id
      and app.current_tenant_id() in (jp.host_tenant_id, jp.invited_tenant_id)
  ));
create policy joint_project_grants_host_admin_write on joint_project_grants
  for all to authenticated
  using (app.is_admin() and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ))
  with check (app.is_admin() and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ));
