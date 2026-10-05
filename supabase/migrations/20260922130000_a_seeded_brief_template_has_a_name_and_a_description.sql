-- SJ-v3-01 (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep) — the kind of brief is picked from a
-- card per template, and a card reads the template's NAME in both languages and one line saying
-- what it is for.
--
-- Two things were missing.
--
-- 1. A tenant provisioned after 30 Aug has NO NAMES on its seeded templates. `20260830210000`
--    backfilled `name_en` / `name_ar` on the rows that existed that day and then fell back to the
--    key — but `app.seed_tenant_brief_templates` and `app.seed_tenant_digital_build_brief` still
--    insert only `(tenant_id, brief_type, fields)`, so every tenant seeded since (the local
--    stack among them) shows `social_calendar` where "Social Media Brief" should be. The API's
--    fallback to the key is what hid it.
--
-- 2. There is no description column. The Figma puts one line under each name — "One asset,
--    already agreed. Just say what you need." — and nothing in the table holds it.
--
-- Both are fixed by ONE new seed step, `app.seed_tenant_brief_template_names`, which fills a name
-- and a description WHERE NULL for the twelve seeded keys and is called by the provisioning
-- wrapper after the two template seeds. Existing tenants are backfilled here the same way. A
-- tenant's own wording is never overwritten: only nulls are touched, on every path.
--
-- The provisioning wrapper is REPRODUCED WHOLE from `20260914100000` (traps.md: it has lost seeds
-- twice); pgTAP 114 fails if any `app.seed_*` is missing from its body.
--
-- Arabic: the six descriptions the Figma carries are the designer's; the other six are first
-- drafts awaiting a native reader (I18.8), like the four Edward-authored templates' names.

begin;

alter table brief_templates
  add column if not exists description_en text,
  add column if not exists description_ar text;

comment on column brief_templates.description_en is
  'One line under the name on a brief card (SJ-v3-01): what this brief is for. Data, not an '
  'i18n key, like name_en — a template the tenant creates has no key.';
comment on column brief_templates.description_ar is
  'The Arabic description. Six are from the Figma; the rest are first drafts awaiting a native '
  'reader (I18.8).';

-- ---------------------------------------------------------------- the seed ----

create or replace function app.seed_tenant_brief_template_names(p_tenant uuid) returns void
language plpgsql
-- ADR-0033: every function carries its search_path pin. CREATE OR REPLACE resets proconfig.
set search_path = public, app, extensions as $$
begin
  update brief_templates t
     set name_en        = coalesce(t.name_en, v.en),
         name_ar        = coalesce(t.name_ar, v.ar),
         description_en = coalesce(t.description_en, v.desc_en),
         description_ar = coalesce(t.description_ar, v.desc_ar)
    from (values
      -- the deck's seven (20260830210000) ------------------------------------------------
      ('360',                     'Creative Brief',                 'بريف إبداعي — حملات ٣٦٠',
         'The campaign brief — the season in one line, the product rules, the dos and don’ts.',
         'بريف الحملة — الموسم في سطر واحد، وقواعد المنتج، والمسموح والممنوع.'),
      ('social_calendar',         'Social Media Brief',             'بريف السوشيال ميديا',
         'Posts, carousels, reels — with the caption and the channel.',
         'منشورات وكاروسيل وريلز — مع النص والقناة.'),
      ('activation',              'Activation Brief',               'بريف التفعيل',
         'Events, on-ground and live moments. Rundown and talent.',
         'فعاليات ولحظات ميدانية ومباشرة. البرنامج والمواهب.'),
      ('paid_media',              'Performance Brief',              'بريف الإعلانات الممولة',
         'Paid campaigns — the objective, the budget, the platforms and the numbers that count.',
         'الحملات الممولة — الهدف والميزانية والمنصات والأرقام التي تهم.'),
      ('production',              'Production Brief',               'بريف الإنتاج',
         'Anything shot, edited or animated. Script, duration, location.',
         'كل ما يُصوَّر أو يُمنتَج أو يُحرَّك. النص والمدة والموقع.'),
      ('influencer',              'Influencers Brief',              'بريف المؤثرين',
         'Per influencer, per week. Planned versus posted.',
         'لكل مؤثر، لكل أسبوع. المخطط مقابل المنشور.'),
      ('single_execution',        'Execution Brief',                'بريف تنفيذي',
         'One asset, already agreed. Just say what you need.',
         'أصل واحد متفق عليه. قل ما تحتاجه فقط.'),
      -- Edward's four (docs/reference/brief-templates-additional.md) --------------------
      ('creative_strategy',       'Creative Strategy Brief',        'بريف الاستراتيجية الإبداعية',
         'Where the brand stands and the idea that moves it.',
         'أين تقف العلامة والفكرة التي تحرّكها.'),
      ('communications_strategy', 'Communications Strategy Brief',  'بريف استراتيجية التواصل',
         'Who we talk to, what we say, and through which channels.',
         'مع من نتحدث، وماذا نقول، وعبر أي قنوات.'),
      ('brand_guidelines',        'Brand Guidelines Brief',         'بريف دليل الهوية',
         'A new brand, a refresh, or the rules written down.',
         'علامة جديدة، أو تحديث، أو القواعد مكتوبة.'),
      ('custom',                  'Custom Brief',                   'بريف مخصص',
         'Anything the other briefs do not fit. Start from a blank page.',
         'كل ما لا يناسب البريفات الأخرى. ابدأ من صفحة فارغة.'),
      -- ADR-0071 d.4 (20260905090200) -----------------------------------------------------
      ('digital_build',           'Digital Build Brief',            'بريف البناء الرقمي',
         'Sites, landing pages and in-app surfaces. Ships EN, AR, KU.',
         'مواقع وصفحات هبوط وواجهات داخل التطبيق. بالعربية والإنجليزية والكردية.')
    ) as v(brief_type, en, ar, desc_en, desc_ar)
   where t.tenant_id = p_tenant
     and t.brief_type = v.brief_type
     and (t.name_en is null or t.name_ar is null or t.description_en is null or t.description_ar is null);

  -- A template the tenant made before it could be named keeps working: the key is its name.
  update brief_templates set name_en = brief_type
   where tenant_id = p_tenant and name_en is null;
end $$;

comment on function app.seed_tenant_brief_template_names(uuid) is
  'SJ-v3-01, 22 Sep: names and one-line descriptions for the twelve seeded brief templates, filled '
  'WHERE NULL only — a tenant''s own wording is never overwritten. Runs after the two template '
  'seeds in the provisioning wrapper; re-runnable.';

-- ---------------------------------------------------------------- the wrapper ----
-- Reproduced whole from 20260914100000, plus the one new call.

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

-- Every tenant that exists today: names where they are missing, descriptions everywhere.
select app.seed_tenant_brief_template_names(id) from tenants;

commit;
