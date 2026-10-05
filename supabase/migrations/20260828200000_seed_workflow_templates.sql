-- I19.2 (ADR-0052 d.3) — fourteen templates, 154 steps, seeded per tenant.
--
-- GENERATED from `docs/reference/seed-vocabulary-bilingual.md`, not hand-typed — 154 ordered
-- rows is where transcription errors live, and that file is the reviewed source. Regenerate rather
-- than edit when the Arabic comes back from a native speaker.
--
-- WF-01..WF-10 are the taxonomy document's workflow templates; WF-11..WF-14 are the four pipelines
-- in the production model. **The overlapping pairs stay separate** (ADR-0052 d.3): WF-03 Video
-- Production and WF-11 Long Form only LOOK like duplicates. Counting their steps shows neither
-- contains the other — Long Form adds Physical Media, Ingest, Backup and Archive; WF-03 has
-- Concept, Script, Storyboard, Sound and Grade that Long Form lacks. Merging them would lose
-- stages in both directions, and forcing physical-media custody on an agency that outsources
-- production is the same mistake as seeding departments.
--
-- **67 distinct step names across the 154 instances.** "Internal Review" is one glossary
-- entry reused fourteen times, not fourteen translations that can drift apart.
--
-- Nothing here names a person, a department, a team or a role. Every step is an activity
-- ("Prepress", "Rough Cut") or an audience ("Internal Review", "Client Review"), and no reviewer
-- is created with them — that is the assignment decision, and it belongs to a human.
--
-- `default_hours` ships NULL on every seeded step. An estimate nobody has made is worse than no
-- estimate; a tenant fills them from its own history.
--
-- Idempotent: `on conflict do nothing`, so re-running never overwrites a tenant's edits.

begin;

create or replace function app.seed_tenant_workflow_templates(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_template uuid;
begin
  -- ---- WF-01 — Standard Digital ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-01', 'Standard Digital', 'المسار الرقمي القياسي', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-01';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Copy/Content', 'النصوص والمحتوى'),
    (3, 'Design', 'التصميم'),
    (4, 'Internal Review', 'المراجعة الداخلية'),
    (5, 'Client Review', 'مراجعة العميل'),
    (6, 'Revision', 'التعديل'),
    (7, 'Approval', 'الاعتماد'),
    (8, 'Final', 'النسخة النهائية')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-02 — Social Content ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-02', 'Social Content', 'محتوى وسائل التواصل الاجتماعي', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-02';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Copy', 'النصوص'),
    (3, 'Creative', 'العمل الإبداعي'),
    (4, 'Internal Review', 'المراجعة الداخلية'),
    (5, 'Client Review', 'مراجعة العميل'),
    (6, 'Revision', 'التعديل'),
    (7, 'Final', 'النسخة النهائية'),
    (8, 'Scheduling', 'الجدولة')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-03 — Video Production ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-03', 'Video Production', 'إنتاج الفيديو', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-03';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Concept', 'المفهوم الإبداعي'),
    (3, 'Script', 'السيناريو'),
    (4, 'Storyboard', 'الستوري بورد'),
    (5, 'Pre-production', 'ما قبل الإنتاج'),
    (6, 'Production', 'الإنتاج'),
    (7, 'Edit', 'المونتاج'),
    (8, 'Sound', 'معالجة الصوت'),
    (9, 'Grade', 'تصحيح الألوان'),
    (10, 'Internal Review', 'المراجعة الداخلية'),
    (11, 'Client Review', 'مراجعة العميل'),
    (12, 'Revision', 'التعديل'),
    (13, 'Master', 'النسخة الرئيسية'),
    (14, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-04 — Photography ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-04', 'Photography', 'التصوير الفوتوغرافي', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-04';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Creative Direction', 'التوجيه الإبداعي'),
    (3, 'Pre-production', 'ما قبل الإنتاج'),
    (4, 'Shoot', 'التصوير'),
    (5, 'Selection', 'انتقاء اللقطات'),
    (6, 'Retouching', 'التنقيح'),
    (7, 'Internal Review', 'المراجعة الداخلية'),
    (8, 'Client Review', 'مراجعة العميل'),
    (9, 'Final', 'النسخة النهائية')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-05 — Print ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-05', 'Print', 'الطباعة', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-05';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Copy', 'النصوص'),
    (3, 'Design', 'التصميم'),
    (4, 'Internal Review', 'المراجعة الداخلية'),
    (5, 'Client Review', 'مراجعة العميل'),
    (6, 'Revision', 'التعديل'),
    (7, 'Final Artwork', 'الفن النهائي'),
    (8, 'Prepress', 'ما قبل الطباعة'),
    (9, 'Proof', 'البروفة'),
    (10, 'Production', 'الإنتاج'),
    (11, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-06 — Packaging ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-06', 'Packaging', 'التغليف', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-06';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Concept', 'المفهوم الإبداعي'),
    (3, 'Design', 'التصميم'),
    (4, 'Internal Review', 'المراجعة الداخلية'),
    (5, 'Client Review', 'مراجعة العميل'),
    (6, 'Revision', 'التعديل'),
    (7, 'Artwork', 'التنفيذ الفني'),
    (8, 'Prepress', 'ما قبل الطباعة'),
    (9, 'Proof', 'البروفة'),
    (10, 'Production', 'الإنتاج'),
    (11, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-07 — Branding ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-07', 'Branding', 'بناء العلامة التجارية', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-07';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Research', 'البحث'),
    (3, 'Strategy', 'الاستراتيجية'),
    (4, 'Concept', 'المفهوم الإبداعي'),
    (5, 'Creative Development', 'التطوير الإبداعي'),
    (6, 'Internal Review', 'المراجعة الداخلية'),
    (7, 'Client Presentation', 'العرض على العميل'),
    (8, 'Revision', 'التعديل'),
    (9, 'Approval', 'الاعتماد'),
    (10, 'Brand System', 'نظام العلامة التجارية'),
    (11, 'Guidelines', 'الدليل الإرشادي'),
    (12, 'Asset Production', 'إنتاج الأصول')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-08 — Campaign ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-08', 'Campaign', 'الحملة', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-08';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Strategy', 'الاستراتيجية'),
    (3, 'Concept', 'المفهوم الإبداعي'),
    (4, 'Key Visual', 'التصميم الأساسي'),
    (5, 'Internal Review', 'المراجعة الداخلية'),
    (6, 'Client Presentation', 'العرض على العميل'),
    (7, 'Approval', 'الاعتماد'),
    (8, 'Asset Development', 'تطوير الأصول'),
    (9, 'Adaptations', 'التكييفات'),
    (10, 'Final', 'النسخة النهائية'),
    (11, 'Deployment', 'النشر')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-09 — OOH / Environmental ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-09', 'OOH / Environmental', 'الإعلان الخارجي والتصميم البيئي', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-09';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Concept', 'المفهوم الإبداعي'),
    (3, 'Design', 'التصميم'),
    (4, 'Internal Review', 'المراجعة الداخلية'),
    (5, 'Client Approval', 'اعتماد العميل'),
    (6, 'Artwork', 'التنفيذ الفني'),
    (7, 'Production Specification', 'مواصفات الإنتاج'),
    (8, 'Production', 'الإنتاج'),
    (9, 'Proof', 'البروفة'),
    (10, 'Installation', 'التركيب'),
    (11, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-10 — Long-form Physical Production ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-10', 'Long-form Physical Production', 'الإنتاج المادي المطوّل', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-10';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Concept', 'المفهوم الإبداعي'),
    (3, 'Creative Development', 'التطوير الإبداعي'),
    (4, 'Production Planning', 'تخطيط الإنتاج'),
    (5, 'Production', 'الإنتاج'),
    (6, 'Post-production', 'ما بعد الإنتاج'),
    (7, 'Internal Review', 'المراجعة الداخلية'),
    (8, 'Client Review', 'مراجعة العميل'),
    (9, 'Final Master', 'النسخة الرئيسية النهائية'),
    (10, 'Physical Production', 'الإنتاج المادي'),
    (11, 'QA', 'ضبط الجودة'),
    (12, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-11 — Long Form ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-11', 'Long Form', 'المحتوى الطويل', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-11';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Pre-production', 'ما قبل الإنتاج'),
    (3, 'Shoot', 'التصوير'),
    (4, 'Physical Media', 'الوسائط المادية'),
    (5, 'Ingest', 'إدخال الوسائط'),
    (6, 'Backup', 'النسخ الاحتياطي'),
    (7, 'Assembly', 'التجميع الأولي'),
    (8, 'Rough Cut', 'المونتاج الأولي'),
    (9, 'Internal Review', 'المراجعة الداخلية'),
    (10, 'Client Review', 'مراجعة العميل'),
    (11, 'Amendments', 'تنفيذ الملاحظات'),
    (12, 'Fine Cut', 'المونتاج الدقيق'),
    (13, 'Final QC', 'فحص الجودة النهائي'),
    (14, 'Master', 'النسخة الرئيسية'),
    (15, 'Delivery', 'التسليم'),
    (16, 'Archive', 'الأرشفة')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-12 — Short Form ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-12', 'Short Form', 'المحتوى القصير', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-12';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Source Assets', 'الأصول المصدرية'),
    (3, 'Edit', 'المونتاج'),
    (4, 'Graphics', 'الجرافيك'),
    (5, 'Captions', 'الترجمة النصية'),
    (6, 'Internal Review', 'المراجعة الداخلية'),
    (7, 'Client Review', 'مراجعة العميل'),
    (8, 'Amendments', 'تنفيذ الملاحظات'),
    (9, 'Final QC', 'فحص الجودة النهائي'),
    (10, 'Export', 'التصدير'),
    (11, 'Delivery / Scheduling', 'التسليم / الجدولة')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-13 — Photography ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-13', 'Photography', 'التصوير الفوتوغرافي — مسار الإنتاج', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-13';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Brief', 'البريف'),
    (2, 'Shoot', 'التصوير'),
    (3, 'Physical Media', 'الوسائط المادية'),
    (4, 'Ingest', 'إدخال الوسائط'),
    (5, 'Selection', 'انتقاء اللقطات'),
    (6, 'Retouch', 'التنقيح'),
    (7, 'Internal Review', 'المراجعة الداخلية'),
    (8, 'Client Review', 'مراجعة العميل'),
    (9, 'Amendments', 'تنفيذ الملاحظات'),
    (10, 'Final Export', 'التصدير النهائي'),
    (11, 'Delivery', 'التسليم'),
    (12, 'Archive', 'الأرشفة')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

  -- ---- WF-14 — Adaptation / Versioning ----
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-14', 'Adaptation / Versioning', 'التكييف وإصدار النسخ', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-14';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar)
  select p_tenant, v_template, n, en, ar from (values
    (1, 'Master', 'النسخة الرئيسية'),
    (2, 'Adaptation', 'التكييف'),
    (3, 'Format Conversion', 'تحويل الصيغ'),
    (4, 'Copy / Graphics', 'النصوص والجرافيك'),
    (5, 'Internal Review', 'المراجعة الداخلية'),
    (6, 'Client Review', 'مراجعة العميل'),
    (7, 'Final QC', 'فحص الجودة النهائي'),
    (8, 'Delivery', 'التسليم')
  ) as g(n, en, ar)
  on conflict (tenant_id, template_id, sort_order) do nothing;

end $$;

comment on function app.seed_tenant_workflow_templates(uuid) is
  'ADR-0052 d.3: seed the fourteen workflow templates and their steps for a tenant. Idempotent and '
  'non-destructive - on conflict do nothing, so a tenant that has edited a template keeps its edits.';

-- Existing tenants.
select app.seed_tenant_workflow_templates(id) from tenants;

-- Future tenants. Reproduced from the CURRENT wrapper (20260828160000), which now calls roles,
-- disciplines, brief templates and the deliverable taxonomy. Copying an older version would
-- silently drop one of those from provisioning, and nobody would find out until a new tenant
-- opened a screen that needed it.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_disciplines(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant_roles(uuid) to service_role;

commit;
