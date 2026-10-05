-- I48.20 — the provisioning wrapper had lost FOUR seeds, and a fresh tenant proves it.
--
-- `public.seed_tenant_roles` is the wrapper every new tenant is provisioned through, maintained by
-- successive `create or replace`. `20260903100300` found that `20260827200000` had rewritten it
-- WITHOUT `seed_tenant_asset_grants` and `seed_tenant_storage_settings`, restored them, and added
-- `seed_tenant_reminder_settings`. Two days later `20260905090800` reproduced the wrapper from the
-- 30 Aug base instead of the 3 Sep one and dropped all three — and `20260905190300` faithfully
-- reproduced THAT. Nothing failed loudly, for the reason the first fix already named: a
-- `create or replace` of a wrapper cannot tell you what the previous body contained.
--
-- The same rewrite also dropped `seed_tenant_brief_approval_grants` (`20260903130000`): nobody but
-- the Power Admin and the Account Director holds `briefs:approve`, so a department lead cannot
-- approve their own department's brief (found by G4 of the same retest).
--
-- Effect on a tenant provisioned since 5 Sep: nobody but the Power Admin holds `assets:manage`
-- (no filing, no uploads), no `tenant_storage_settings` row (the archive sweep has no residency to
-- read), no `tenant_reminder_settings` row (the T+ threshold and, since 13 Sep, the scheduling
-- rules fall back to defaults, and the Admin → Organization save has nothing to update), and no
-- `briefs:approve` for the department's own people or the AM. Found 14 Sep by the automated retest
-- (C5, G4): the local seed tenant is provisioned through this wrapper.
--
-- The hosted project's tenant predates 27 Aug and has all four; this migration is idempotent for
-- it. New tenants get them again from here on, and `supabase/tests/114` provisions a fresh tenant
-- and asserts every one of them — the guard that would have caught both losses.
--
-- Reproduced WHOLE from `20260905190300` (the latest definition). The ONLY edits are the four
-- restored lines, placed where `20260903100300` had them.

begin;

create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  -- Restored (20260903100300, lost again in 20260905090800): the grants, storage and reminder
  -- rows every tenant needs. All three are `on conflict do nothing`.
  select app.seed_tenant_asset_grants(p_tenant);
  select app.seed_tenant_storage_settings(p_tenant);
  select app.seed_tenant_reminder_settings(p_tenant);
  -- Restored (20260903130000, lost in 20260905090800): briefs:approve for the department's own
  -- people, the AM, Traffic and the deputy (ADR-0070 d.2).
  select app.seed_tenant_brief_approval_grants(p_tenant);
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
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Every app.seed_tenant_* a tenant needs, in dependency order. '
  'REPRODUCE IT WHOLE FROM ITS LATEST DEFINITION when extending it (traps.md) — it has lost seeds '
  'twice (27 Aug, 5 Sep). supabase/tests/114 provisions a fresh tenant, asserts each seed landed, '
  'and fails if any app.seed_* function exists that this body does not call.';

-- Existing tenants provisioned while the seeds were missing. Idempotent for the ones that have them.
select app.seed_tenant_asset_grants(id) from tenants;
select app.seed_tenant_storage_settings(id) from tenants;
select app.seed_tenant_reminder_settings(id) from tenants;
select app.seed_tenant_brief_approval_grants(id) from tenants;

commit;
