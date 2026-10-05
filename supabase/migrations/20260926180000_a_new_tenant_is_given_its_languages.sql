-- I59.37 (found 25 Sep, on a freshly reset local database) — a NEW tenant is given its languages.
--
-- `20260923230000` added the `language` attribute list (I56.7: Arabic, English, Kurdish) by inserting
-- into every tenant that existed AT THAT MOMENT, and never taught provisioning about it. So every
-- tenant created afterwards — a real new agency, and every `supabase db reset` (the dev seed creates
-- its tenant after the migrations run) — has no languages at all: the piece dialog and the campaign
-- rule dialog offer none, and a piece can never be given one. The other five attribute lists are
-- seeded per tenant by `app.seed_tenant_deliverable_taxonomy`; language is now seeded the same way.
--
-- Idempotent: `on conflict do nothing` on the list's own unique key, so a tenant that already has
-- the three (every tenant `20260923230000` reached) or has edited a label keeps what it has.

begin;

create or replace function app.seed_tenant_languages(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
begin
  insert into deliverable_attribute_values (tenant_id, attribute, code, label_en, label_ar, sort_order)
  select p_tenant, 'language'::deliverable_attribute, v.code, v.en, v.ar, v.ord
    from (values
      ('ar', 'Arabic',   'العربية',   1),
      ('en', 'English',  'الإنجليزية', 2),
      ('ku', 'Kurdish',  'الكردية',    3)
    ) as v(code, en, ar, ord)
  on conflict (tenant_id, attribute, code) do nothing;
end $$;

comment on function app.seed_tenant_languages(uuid) is
  'I59.37: the `language` attribute list (I56.7) for one tenant — Arabic, English, Kurdish, in both '
  'names. `on conflict do nothing`: a tenant''s own edits are never overwritten. Called by the '
  'provisioning wrapper.';

-- Every tenant today (a no-op wherever 20260923230000 already reached).
select app.seed_tenant_languages(id) from tenants;

-- ---------------------------------------------------------------- the wrapper ----
-- Reproduced WHOLE from 20260926120000 (the last definition), plus the one new call at the end.
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
  -- SJ-v3-01 (20260922130000): names and descriptions on the templates the two seeds above made.
  select app.seed_tenant_brief_template_names(p_tenant);
  -- SJ-v3-02 (20260922150000): which of each template's fields are the essentials.
  select app.seed_tenant_brief_essentials(p_tenant);
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
  -- ---- I59.24 (ADR-0108) ----
  -- After the reminder row (it copies assignment_escalation_hours) and after the Account Director
  -- (it names that role).
  select app.seed_tenant_escalation_rules(p_tenant);
  -- ---- I59.37 ----
  -- The language list beside the taxonomy's other attribute lists (I56.7).
  select app.seed_tenant_languages(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Every app.seed_tenant_* a tenant needs, in dependency order. '
  'REPRODUCE IT WHOLE FROM ITS LATEST DEFINITION when extending it (traps.md) — it has lost seeds '
  'twice (27 Aug, 5 Sep). supabase/tests/114 provisions a fresh tenant, asserts each seed landed, '
  'and fails if any app.seed_* function exists that this body does not call.';

commit;
