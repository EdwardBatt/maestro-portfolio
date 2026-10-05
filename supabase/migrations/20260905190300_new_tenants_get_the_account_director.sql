-- I40 (ADR-0073 d.3) — the provisioning wrapper learns about the Account Director.
--
-- `20260905190000` backfills every tenant that exists TODAY. Without this, a tenant created tomorrow
-- has no Account Director at all, and the difference only surfaces when somebody tries to assign the
-- role and cannot find it. `20260905090800` already carries the warning in its own header:
-- *"the list must be complete — anything omitted here is silently dropped from provisioning."*
--
-- Reproduced WHOLE from `20260905090800`, per that file's own note. The ONLY edit is the last line.

begin;

create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_step_review_modes(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
  -- ---- I38 (ADR-0071) ----
  select app.seed_tenant_i38_deactivations(p_tenant);
  select app.seed_tenant_digital_build_brief(p_tenant);
  select app.seed_tenant_i38_step_names(p_tenant);
  select app.seed_tenant_i38_direction_steps(p_tenant);
  select app.seed_tenant_i38_new_templates(p_tenant);
  select app.seed_tenant_i38_branding_components(p_tenant);
  -- last, because it joins deliverable_types by code and wants the taxonomy settled first
  select app.seed_tenant_brief_deliverable_types(p_tenant);
  -- ---- I40 (ADR-0073) ----
  -- After the roles seed, because it copies the Account Manager's grants and needs that role to
  -- exist first.
  select app.seed_account_director(p_tenant);
$$;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Extended by ADR-0071 with the seven I38 seeds and by ADR-0073 '
  'with the Account Director, so a tenant created after this migration gets the same taxonomy, '
  'briefs, templates and roles as the ones that existed when it was applied. Order matters: renames '
  'run before the steps positioned relative to them, the brief/type mapping runs after the taxonomy '
  'is settled, and the Account Director runs after the roles it copies from.';

commit;
