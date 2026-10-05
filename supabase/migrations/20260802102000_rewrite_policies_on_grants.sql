-- L1.8 (ADR-0008): every role-name policy becomes a grant check.
--
-- app.is_admin() / app.jwt_role() are replaced by app.has_permission() and then
-- DROPPED — after this migration nothing in the database can reason about a
-- role by name; abilities exist only as grant rows. Policy names keep their
-- historical audience words (_admin_, _scheduler_) where dropping them would
-- churn the pgTAP suite for no security gain; the bodies are what enforce.
--
-- Mapping (ADR-0008):
--   organization:manage  offices, clients, brands, departments, accountability/
--                        sla profiles, work types
--   users:manage         user_profiles admin writes
--   resources:manage     resources
--   projects:manage      campaigns, streams, jobs
--   project_tasks:manage deliverables
--   bookings:create/update/delete + series; blackouts:manage unavailability
--   media:manage         media_records; reviews:moderate review moderation
--   audit:view           audit_events reads
--   joint_projects:manage joint project shape (host side)
--   roles:manage         roles + role_grants administration (new policies)

-- ------------------------------------------------------------- offices ----
drop policy offices_admin_insert on offices;
drop policy offices_admin_update on offices;
drop policy offices_admin_delete on offices;
create policy offices_admin_insert on offices
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
create policy offices_admin_update on offices
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
create policy offices_admin_delete on offices
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

-- ------------------------------------------------------- user_profiles ----
drop policy user_profiles_admin_all on user_profiles;
create policy user_profiles_admin_all on user_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('users', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('users', 'manage'));

-- ------------------------------------- clients / brands / departments ----
drop policy clients_admin_write on clients;
create policy clients_admin_write on clients
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
drop policy brands_admin_write on brands;
create policy brands_admin_write on brands
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
drop policy departments_admin_write on departments;
create policy departments_admin_write on departments
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

-- ----------------------------------------------------------- resources ----
drop policy resources_admin_write on resources;
create policy resources_admin_write on resources
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('resources', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('resources', 'manage'));

-- ------------------------------------------------------ work structure ----
drop policy accountability_profiles_admin_write on accountability_profiles;
create policy accountability_profiles_admin_write on accountability_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
drop policy sla_profiles_admin_write on sla_profiles;
create policy sla_profiles_admin_write on sla_profiles
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
drop policy work_types_admin_write on work_types;
create policy work_types_admin_write on work_types
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

drop policy campaigns_tenant_write on campaigns;
create policy campaigns_tenant_write on campaigns
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));
drop policy streams_tenant_write on streams;
create policy streams_tenant_write on streams
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));
drop policy jobs_tenant_write on jobs;
create policy jobs_tenant_write on jobs
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));
drop policy deliverables_tenant_write on deliverables;
create policy deliverables_tenant_write on deliverables
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'));

-- -------------------------------------------- bookings + blackouts --------
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'create'));
drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'update'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'update'));
drop policy bookings_scheduler_delete on bookings;
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'delete'));

drop policy resource_unavailability_scheduler_write on resource_unavailability;
create policy resource_unavailability_scheduler_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('blackouts', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('blackouts', 'manage'));

drop policy booking_series_scheduler_write on booking_series;
create policy booking_series_scheduler_write on booking_series
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'create'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('bookings', 'create'));

-- -------------------------------------------------------- audit events ----
drop policy audit_events_admin_select on audit_events;
create policy audit_events_admin_select on audit_events
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('audit', 'view'));

-- ------------------------------------------------------ joint projects ----
drop policy joint_projects_host_admin_write on joint_projects;
create policy joint_projects_host_admin_write on joint_projects
  for all to authenticated
  using (host_tenant_id = app.current_tenant_id() and app.has_permission('joint_projects', 'manage'))
  with check (host_tenant_id = app.current_tenant_id() and app.has_permission('joint_projects', 'manage'));
drop policy joint_project_grants_host_admin_write on joint_project_grants;
create policy joint_project_grants_host_admin_write on joint_project_grants
  for all to authenticated
  using (app.has_permission('joint_projects', 'manage') and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ))
  with check (app.has_permission('joint_projects', 'manage') and exists (
    select 1 from joint_projects jp
    where jp.id = joint_project_id and jp.host_tenant_id = app.current_tenant_id()
  ));

-- ----------------------------------------------------- media + reviews ----
drop policy media_records_tenant_write on media_records;
create policy media_records_tenant_write on media_records
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('media', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('media', 'manage'));

drop policy review_feedback_author_update on review_feedback;
create policy review_feedback_author_update on review_feedback
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and (author_user_id = auth.uid() or app.has_permission('reviews', 'moderate')))
  with check (tenant_id = app.current_tenant_id());

-- -------------------------------- roles + role_grants administration ------
-- Deferred from 20260802100000: grants exist now, so the rules screen works.
create policy roles_manager_insert on roles
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'));
create policy roles_manager_update on roles
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'));
create policy roles_manager_delete on roles
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'));

create policy role_grants_manager_insert on role_grants
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'));
create policy role_grants_manager_delete on role_grants
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('roles', 'manage'));
-- (no UPDATE policy: a grant is its primary key — it exists or it does not)

-- --------------------------------------------------- retire old helpers ---
drop function app.is_admin();
drop function app.jwt_role();
