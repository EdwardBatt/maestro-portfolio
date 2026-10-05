-- L1.8 (ADR-0008): profiles join the org chart; role enum → roles table cutover.
--
-- user_profiles gains role_id (the platform role), department_id and job_title
-- (org-chart facts — display/filtering, never access). Existing users map:
--   admin → power_admin, booker → scheduler, team_lead → department_lead,
--   creative/support → team_member, client_portal → client_portal.
-- The enum column and type are then dropped (pre-launch: no live team data).
--
-- NOTE for apply time: after this migration, existing auth users need their
-- JWT claim re-provisioned (app_role → app_role_id) — scripts/resync-claims.mjs
-- does it in one pass. Until a user's claim is resynced they can sign in but
-- hold no grants (fail-closed, not fail-open).

alter table user_profiles add column role_id uuid references roles(id);
alter table user_profiles add column department_id uuid references departments(id);
alter table user_profiles add column job_title text;

create index idx_user_profiles_role_id on user_profiles (role_id);
create index idx_user_profiles_department_id on user_profiles (department_id);

update user_profiles up
set role_id = r.id
from roles r
where r.tenant_id = up.tenant_id
  and r.key = case up.role::text
        when 'admin'         then 'power_admin'
        when 'booker'        then 'scheduler'
        when 'team_lead'     then 'department_lead'
        when 'client_portal' then 'client_portal'
        else 'team_member'   -- creative, support
      end;

alter table user_profiles alter column role_id set not null;

-- Self-update policy pinned the enum role; re-pin role_id the same way
-- (column privileges already block role_id writes — this is defense in depth).
drop policy user_profiles_self_update on user_profiles;
create policy user_profiles_self_update on user_profiles
  for update to authenticated
  using (id = auth.uid() and tenant_id = app.current_tenant_id())
  with check (id = auth.uid() and tenant_id = app.current_tenant_id()
              and role_id = (select up.role_id from user_profiles up where up.id = auth.uid()));

alter table user_profiles drop column role;
drop type user_role;

comment on column user_profiles.role_id is
  'Platform role (roles table) — what the person can DO. Written only by admin '
  'Edge Functions, atomically with the app_role_id JWT claim.';
comment on column user_profiles.department_id is
  'Org-chart membership (display/filtering). Never used for access decisions.';
comment on column user_profiles.job_title is
  'Org-chart fact (display only). Never used for access decisions.';
