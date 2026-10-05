-- I35.6 (ADR-0066 d.8) — the T+ threshold is a setting, not a constant.
--
-- Edward, 3 Sep: the T+ figure belongs on an admin screen. ADR-0045 d.3 had already decided the same
-- thing for the chase and escalation rungs — *"both are edited in the UI, not in a migration"* — and
-- `I14.7` plans an **Admin → Reminders** screen for them on the `tenant_storage_settings` shape.
-- This is that table, arriving early because ADR-0066 needs one field from it. `I14.7` adds its two
-- columns and builds the screen; nothing here has to move for that to happen.
--
-- WALL-CLOCK, NOT WORKING HOURS, AND THAT IS A DEPARTURE. ADR-0005 gives every office a working
-- week and ADR-0045's rungs are stated in working hours, precisely so a weekend cannot manufacture a
-- breach. Edward chose wall-clock here (3 Sep) and ADR-0066 records it as deliberate: this interval
-- is the one discussed with a client, and a client does not care about the agency's working week.
-- The accepted consequence is that a brief arriving before a non-working day shows as an exception
-- on a day nobody worked. This column being editable is what makes that survivable without a
-- developer, which is most of why it is a column.
--
-- HOURS, NOT DAYS. "T+1" is a way of speaking, not a unit. Stored as hours because that is what the
-- neighbouring reminder thresholds are, because 36 is a thing somebody will want, and because a
-- day-based column would need a definition of when a day ends that nothing else in this schema has.
--
-- ------------------------------------------------------------------------------------------------
-- ALSO FIXED HERE, AND FOUND BY ACCIDENT: two seeds had fallen out of the provisioning wrapper.
--
-- `public.seed_tenant_roles` is the wrapper every new tenant is provisioned through, and it is
-- maintained by successive `create or replace`. `20260827200000_brief_templates.sql` rewrote it
-- WITHOUT `app.seed_tenant_asset_grants` and `app.seed_tenant_storage_settings`, both of which had
-- been there since 17 August. Nothing failed loudly, because a `create or replace` of a wrapper
-- cannot tell you what the previous body contained. The effect: **every tenant created since 27
-- August has had no asset grants and no storage-settings row** — meaning nobody in it can use the
-- Library at all, and the archive sweep has no residency setting to read. (`seed_tenant_disciplines`
-- also left the wrapper, but deliberately and correctly, when ADR-0056 retired disciplines.)
--
-- Both restored below. Both are idempotent — `on conflict do nothing` — so re-adding them is safe
-- for existing tenants and does nothing to them; the wrapper only runs on tenant creation. This is
-- outside the scope of `I35` and is repaired here anyway, because the alternative is knowingly
-- rewriting this exact function and leaving the bug in it.

begin;

-- ------------------------------------------------ per-tenant thresholds ----
create table tenant_reminder_settings (
  tenant_id            uuid primary key references tenants(id),
  -- ADR-0066 d.7/d.8. Wall-clock hours from the CONFIRMED received_at to `campaigns.approved_at`.
  brief_approval_hours integer not null default 24
                         check (brief_approval_hours between 1 and 720),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table tenant_reminder_settings is
  'ADR-0066 d.8 (and the home ADR-0045 d.3 / I14.7 specified for the chase and escalation rungs, '
  'which land here when that screen is built). Admin → Reminders, behind organization:manage.';

comment on column tenant_reminder_settings.brief_approval_hours is
  'ADR-0066 d.7: WALL-CLOCK hours a brief has to reach `approved` from its confirmed received_at '
  'before the campaign is in exception. Wall-clock is a deliberate departure from this project''s '
  'working-hours precedent (ADR-0005/0045) — see the ADR. Default 24 ("T+1").';

alter table tenant_reminder_settings enable row level security;
alter table tenant_reminder_settings force row level security;

-- Read by everyone in the tenant: the exception is computed on READ (d.9), on surfaces that are not
-- admin-only, so every reader of a campaign needs the threshold to know what it means.
create policy tenant_reminder_settings_tenant_select on tenant_reminder_settings
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy tenant_reminder_settings_admin_write on tenant_reminder_settings
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on tenant_reminder_settings
  for each row execute function app.set_updated_at();

create or replace function app.seed_tenant_reminder_settings(p_tenant uuid) returns void
language plpgsql as $$
begin
  insert into tenant_reminder_settings (tenant_id) values (p_tenant)
  on conflict (tenant_id) do nothing;
end $$;

select app.seed_tenant_reminder_settings(id) from tenants;

-- ------------------------------------------------- the wrapper, repaired ----
-- Reproduced whole from `20260830090000_review_mode_digital_or_manual.sql:696`, plus the new seed
-- and the two that had fallen out (see the header). Nothing is removed.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
  select app.seed_tenant_reminder_settings(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

-- Existing tenants that were created after 27 August and therefore never got them. Both inserts are
-- `on conflict do nothing`, so tenants that already have them are untouched.
select app.seed_tenant_asset_grants(id) from tenants;
select app.seed_tenant_storage_settings(id) from tenants;

commit;
