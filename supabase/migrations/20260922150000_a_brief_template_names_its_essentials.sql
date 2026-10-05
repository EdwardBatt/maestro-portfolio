-- SJ-v3-02 (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep) — a template says which of its fields are
-- THE ESSENTIALS.
--
-- The brief page shows a template in two sections, "1 · The essentials" and "2 · The rest". The
-- first build split at the fourth field by position; Edward, 22 Sep: *"we need to ensure that the
-- templates are divided into 1. The essentials and 2. the Rest as per the concepts"* — a property
-- of the template, set by the tenant, not a count.
--
-- Shape: a boolean `essential` on each field object in `brief_templates.fields` (jsonb) — the same
-- place `key`, `en`, `ar`, `guidance` and `multiline` live, so no new column and no change to the
-- readers that already parse the array. Absent means false.
--
-- Seeded per the Figma for the six briefs it draws, and by the ADR-0048 d.2 authoring order for the
-- rest (the seeded templates open with their most important fields). WHERE NO FIELD IS FLAGGED
-- ONLY — a tenant that has ticked its own essentials keeps them. Re-runnable, called by the
-- provisioning wrapper (reproduced whole from 20260922130000).

begin;

create or replace function app.seed_tenant_brief_essentials(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
declare
  r record;
  v_keys text[];
  v_fields jsonb;
  v_field jsonb;
  v_out jsonb;
  v_i int;
begin
  for r in select id, brief_type, fields from brief_templates where tenant_id = p_tenant loop
    -- Already decided by the tenant (or an earlier run): leave it.
    if exists (select 1 from jsonb_array_elements(coalesce(r.fields, '[]'::jsonb)) f where (f->>'essential')::boolean) then
      continue;
    end if;
    v_keys := case r.brief_type
      when 'single_execution'        then array['deliverableType', 'task', 'reference', 'specs']
      when 'social_calendar'         then array['objective', 'periodVolume', 'audience', 'toneOfVoice']
      when 'production'              then array['productionType', 'objectiveUsage', 'keyMessage', 'scriptStatus']
      when 'influencer'              then array['campaignObjective', 'keyMessage', 'influencerProfile', 'contentFormats']
      when 'activation'              then array['activationType', 'task', 'background', 'audienceOnSite']
      when 'digital_build'           then array['background', 'objective', 'scope', 'audience']
      when '360'                     then array['background', 'task', 'audiencePrimary', 'proposition']
      when 'paid_media'              then array['businessSnapshot', 'campaignObjective', 'targetAudience', 'monthlyBudget']
      when 'creative_strategy'       then array['background', 'businessObjective', 'audienceTension', 'brandRole']
      when 'communications_strategy' then array['background', 'commsObjective', 'audienceJourney', 'channelRoles']
      when 'brand_guidelines'        then array['background', 'scope', 'brandFoundation', 'toneOfVoice']
      when 'custom'                  then array['background', 'task', 'audience', 'deliverables']
      else null
    end;
    v_fields := coalesce(r.fields, '[]'::jsonb);
    v_out := '[]'::jsonb;
    v_i := 0;
    for v_field in select * from jsonb_array_elements(v_fields) loop
      -- Named for a known template; the first four for a template the tenant made.
      if (v_keys is not null and (v_field->>'key') = any (v_keys)) or (v_keys is null and v_i < 4) then
        v_field := v_field || jsonb_build_object('essential', true);
      end if;
      v_out := v_out || jsonb_build_array(v_field);
      v_i := v_i + 1;
    end loop;
    update brief_templates set fields = v_out where id = r.id;
  end loop;
end $$;

comment on function app.seed_tenant_brief_essentials(uuid) is
  'SJ-v3-02, 22 Sep: marks each template''s ESSENTIAL fields (`essential: true` on the field '
  'object) — the Figma''s four for the six briefs it draws, the authoring order for the rest — '
  'only where a template has none flagged. A tenant''s own ticks are never overwritten.';

-- ---------------------------------------------------------------- the wrapper ----
-- Reproduced whole from 20260922130000, plus the one new call.

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
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

comment on function public.seed_tenant_roles(uuid) is
  'The tenant provisioning wrapper. Every app.seed_tenant_* a tenant needs, in dependency order. '
  'REPRODUCE IT WHOLE FROM ITS LATEST DEFINITION when extending it (traps.md) — it has lost seeds '
  'twice (27 Aug, 5 Sep). supabase/tests/114 provisions a fresh tenant, asserts each seed landed, '
  'and fails if any app.seed_* function exists that this body does not call.';

-- Every tenant that exists today.
select app.seed_tenant_brief_essentials(id) from tenants;

commit;
