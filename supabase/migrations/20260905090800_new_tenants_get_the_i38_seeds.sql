-- I38 (ADR-0071) — a tenant provisioned tomorrow gets everything I38 added.
--
-- Each I38 migration ran its own seed function across `tenants` for the tenants that exist TODAY.
-- This is the other half, and it is the half that is easy to forget: `public.seed_tenant_roles` is
-- the provisioning wrapper every new tenant goes through, and a seed function that is not in it
-- runs exactly once, for the tenants alive when its migration was applied, and never again.
--
-- The failure it prevents has a name on this project. ADR-0059's own migration records it: *"a
-- column no seed writes is a feature nobody can find... `deliverable_types.default_workflow_
-- template_id` was read by the materialiser and written by nothing, and 240 types shipped with no
-- template for a day."* The equivalent here would be a tenant created next month whose Branding
-- template has no identity components, whose steps still read `Copy/Content`, and who therefore
-- gets a different product from the one this ADR describes.
--
-- ORDER IS LOAD-BEARING, and it is the same order the migrations themselves ran in:
--
--   * the taxonomy and its amendments exist before anything deactivates part of it;
--   * the base templates and the 28 Aug step corrections exist before steps are renamed;
--   * `seed_tenant_i38_step_names` renames `Concept` to `Develop Concept` BEFORE
--     `seed_tenant_i38_direction_steps` inserts `Develop Concept` where it is missing — otherwise
--     a template that already had `Concept` gets both, under two names, meaning the same thing;
--   * the Branding revision runs after the renames, because it positions Creative Direction
--     relative to `Write Strategy`, which is `Strategy` until the rename has happened.
--
-- Reproduced WHOLE from 20260830090000:  `create or replace` on a `language sql` wrapper is safe,
-- but the list must be complete — anything omitted here is silently dropped from provisioning.

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
$$;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Extended by ADR-0071 with the seven I38 seeds so a tenant created '
  'after this migration gets the same taxonomy, briefs and templates as the ones that existed when '
  'it was applied. Order matters: renames run before the steps that are positioned relative to '
  'them, and before Develop Concept is inserted where missing.';

commit;
