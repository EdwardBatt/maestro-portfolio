-- I21 (ADR-0056) — `work_types` is retired.
--
-- The table did two unrelated jobs. The LABEL job — "which discipline is this?" — was answered by
-- ADR-0053 d.1, which made `deliverables.department_id` the label, derived from the owner. The
-- SETTINGS job — lead time, load, revision limit, SLA profile — moved to `deliverable_types`
-- (ADR-0051 d.12 declared those four columns; they have been written and read by nothing since).
-- What is left is a seeded six-row list that nothing uses, so it goes.
--
-- ============================================================================
-- WHAT THIS DELETES, AND WHY IT IS SAFE TO
-- ============================================================================
-- Verified against the live database on 2026-08-29, unscoped across every tenant:
--
--   streams.work_type_id          0 of 0    rows set
--   jobs.work_type_id             0 of 1    rows set
--   bookings.work_type_id         0 of 67   rows set
--   sla_profiles.work_type_id     0 of 1    rows set
--   kpi_definitions.work_type_id  0 of 1    rows set
--
-- and all six `work_types` rows are the untouched seed (Creative, Social & Content, Production,
-- Influencer, Activation, Paid Media), none carrying an SLA profile or any other setting. Nothing
-- references a work type anywhere, so there is nothing to migrate and nothing to lose.
--
-- ============================================================================
-- DEVIATION FROM ADR-0056, AGREED WITH EDWARD 2026-08-29
-- ============================================================================
-- **d.9/d.10 are not implemented.** The ADR specifies a backfill that maps each work type onto a
-- department (then a team), plus a `work_types_retirement_unmapped` audit table to record whatever
-- it could not place. On zero referencing rows that machinery would be built and never execute —
-- `AGENTS.md` §5, no speculative abstraction.
--
-- **d.11 IS implemented, and strengthened.** The refusal is what carries the safety property, so it
-- stays: the migration counts anything that would be lost and raises rather than dropping. It is
-- also broadened from the ADR's "unmapped rows" to "any reference OR any setting", because with no
-- backfill the check is the only thing standing between a surprise and silent data loss.
--
-- **d.4/d.5 land short of their target.** The ADR removes the work-type tier from a SEVEN-tier
-- `app.effective_sla` and expects a six-tier chain, and it narrows a three-axis CHECK on
-- `sla_profiles` to two. Both assume ADR-0053 d.2/d.4 have shipped. They have not — that is
-- `I20.2`/`I20.3`, ⚠️-GATED on ADR-0032, which is a management decision and is not agreed. So the
-- chain lands at FOUR tiers and `sla_profiles` carries no axis at all. The two missing tiers are
-- exactly the gated ones and slot in above the tenant default when the gate lifts; nothing here
-- has to be revisited to add them.

begin;

-- ============================================================================
-- 1) THE REFUSAL. Nothing below runs if anything would be lost.
-- ============================================================================
-- A `raise notice` scrolls past in a `supabase db push` log and is read by nobody. There is no
-- compiler safety net anywhere near this table — every file that touched it was on an untyped
-- client — so a notice would be the weakest possible signal on the strongest possible action.
--
-- The escape hatch is deliberate and has to be typed by a person who has looked:
--   set local app.work_types_retirement_accept_unmapped = 'on';
do $$
declare
  v_refs     integer;
  v_settings integer;
begin
  select (select count(*) from streams          where work_type_id is not null)
       + (select count(*) from jobs             where work_type_id is not null)
       + (select count(*) from bookings         where work_type_id is not null)
       + (select count(*) from sla_profiles     where work_type_id is not null)
       + (select count(*) from kpi_definitions  where work_type_id is not null)
    into v_refs;

  -- Settings matter separately from references: a work type nothing points at can still hold a
  -- lead time somebody configured, and dropping the table would take it with no record.
  -- `accountability_profile_id` is included because ADR-0056 d.3 deliberately carries it nowhere.
  select count(*) into v_settings
    from work_types
   where lead_time_hours is not null
      or default_load_pct is not null
      or sla_profile_id is not null
      or accountability_profile_id is not null;

  if v_refs > 0 or v_settings > 0 then
    if coalesce(current_setting('app.work_types_retirement_accept_unmapped', true), '') = 'on' then
      raise notice
        'work_types retirement: proceeding over % reference(s) and % configured work type(s) because app.work_types_retirement_accept_unmapped is on',
        v_refs, v_settings;
    else
      raise exception
        'work_types retirement REFUSED: % row(s) still reference a work type and % work type(s) carry settings. Nothing has been dropped. Look at streams/jobs/bookings/sla_profiles/kpi_definitions.work_type_id and work_types (lead_time_hours, default_load_pct, sla_profile_id, accountability_profile_id). To proceed anyway: set local app.work_types_retirement_accept_unmapped = ''on'';',
        v_refs, v_settings
        using errcode = '23503';
    end if;
  end if;
end $$;

-- ============================================================================
-- 2) app.effective_sla loses its two work-type tiers
-- ============================================================================
-- Reproduced whole from `20260819180000:51` rather than patched, which is the house pattern for
-- `create or replace` — a bare replace resets `proconfig` and silently drops the ADR-0033
-- `search_path` pin. Tiers 4 and 5 (work type explicit, work type default) are removed; every
-- other line, including the fall-through rule, is unchanged.
create or replace function app.effective_sla(p_sub_task uuid)
returns numeric
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v_tenant      uuid;
  v_sla_hours   numeric;
  v_st_profile  uuid;
  v_job_profile uuid;
  v_result      numeric;
begin
  select s.tenant_id, s.sla_hours, s.sla_profile_id, j.sla_profile_id
    into v_tenant, v_sla_hours, v_st_profile, v_job_profile
  from sub_tasks s
  join deliverables d on d.id = s.deliverable_id
  left join jobs    j   on j.id   = d.job_id
  where s.id = p_sub_task;
  if not found then return null; end if;

  -- 1. manual leaf override
  if v_sla_hours is not null then return v_sla_hours; end if;

  -- 2. leaf profile
  select turnaround_hours into v_result from sla_profiles where id = v_st_profile;
  if v_result is not null then return v_result; end if;

  -- 3. project (job) profile
  select turnaround_hours into v_result from sla_profiles where id = v_job_profile;
  if v_result is not null then return v_result; end if;

  -- 4. tenant default — earliest wins deterministically.
  --
  -- ADR-0053 d.2's DELIVERABLE-TYPE and DEPARTMENT tiers belong immediately above this one. They
  -- are I20.2/I20.3 and are gated on ADR-0032; when that is agreed they insert here and nothing
  -- else in this function changes.
  select turnaround_hours into v_result from sla_profiles
    where tenant_id = v_tenant and is_default
    order by created_at, id limit 1;
  return v_result;
end $$;

comment on function app.effective_sla(uuid) is
  'ADR-0029, amended by ADR-0056 d.4: resolve a sub-task''s effective SLA turnaround (hours) — '
  'leaf sla_hours override, then the leaf, project and tenant-default profiles. The work-type '
  'tiers went with the table. ADR-0053''s deliverable-type and department tiers (I20.2/I20.3, '
  'gated on ADR-0032) belong directly above the tenant default. Null if unset.';

-- ============================================================================
-- 3) kpi_definitions.work_type_id becomes deliverable_type_id (d.6)
-- ============================================================================
-- Declared but read by no logic — `app.kpi_rollup` does not reference it — so this is a rename
-- onto the axis that replaced it, with no behavioural change. Whether KPIs also want a department
-- axis is a KPI question and is deliberately not answered here.
alter table kpi_definitions drop column if exists work_type_id;
alter table kpi_definitions
  add column if not exists deliverable_type_id uuid references deliverable_types(id);
create index if not exists idx_kpi_definitions_deliverable_type_id
  on kpi_definitions (deliverable_type_id);
comment on column kpi_definitions.deliverable_type_id is
  'ADR-0056 d.6: replaced work_type_id. Declared for a future KPI axis; read by no logic today.';

-- ============================================================================
-- 4) provisioning stops seeding disciplines (d.8)
-- ============================================================================
-- Reproduced from the CURRENT wrapper, `20260828200000_seed_workflow_templates.sql:382`, minus the
-- discipline call. NOT from `20260827200000` as ADR-0056 d.8 says — the wrapper has been re-emitted
-- twice since that ADR was written and now calls five seeders. Copying the version the ADR points
-- at would silently drop brief templates, the deliverable taxonomy AND the workflow templates from
-- new-tenant provisioning, and nobody would find out until the next customer opened a screen.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

drop function if exists app.seed_tenant_disciplines(uuid);

-- ============================================================================
-- 5) the five FK columns (d.5, d.7)
-- ============================================================================
-- Their indexes go with them; `uq_sla_profile_wt_default` and `idx_sla_profiles_work_type_id` are
-- dropped by name first so the intent is visible rather than implied by a cascade.
drop index if exists uq_sla_profile_wt_default;
drop index if exists idx_sla_profiles_work_type_id;
alter table sla_profiles drop column if exists work_type_id;

-- The invariant `uq_sla_profile_wt_default` carried has to survive its column: ONE default profile
-- per tenant. Without this a second default is accepted, `effective_sla` silently falls back to
-- "earliest wins", and the surface's duplicate-default message (23505) becomes unreachable.
create unique index if not exists uq_sla_profiles_tenant_default
  on sla_profiles (tenant_id) where is_default;
comment on index uq_sla_profiles_tenant_default is
  'ADR-0056 d.5: replaces uq_sla_profile_wt_default. One default profile per tenant now that a '
  'profile has no axis to be default FOR. Narrows again when ADR-0053 d.4''s columns land (I20.3).';

alter table streams  drop column if exists work_type_id;
alter table jobs     drop column if exists work_type_id;
alter table bookings drop column if exists work_type_id;

-- ============================================================================
-- 6) the table (d.1)
-- ============================================================================
-- Its RLS policies, its updated_at trigger and its audit trigger (attached by the one-off loop in
-- `20260802103000`) are dropped with it. `accountability_profiles` survives as a table — only the
-- FK from here goes (d.3).
drop table if exists work_types;

commit;
