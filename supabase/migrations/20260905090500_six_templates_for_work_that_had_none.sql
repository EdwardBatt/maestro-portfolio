-- I38.5 (ADR-0071 d.5) — the six workflow templates the agency's work needed and never had.
--
-- WF-15 Influencer Engagement, WF-16 Creator Content, WF-17 Media & Performance,
-- WF-18 Event / Activation, WF-19 Strategy Document, WF-20 Digital Build.
--
-- WHY THEY WERE MISSING, precisely: the fourteen seeded templates were transcribed on 28 August
-- from the taxonomy document and the production model. The INF, MED and AUD categories were added
-- on 29 August — the day AFTER — so when `20260829130000` gave every category a default workflow,
-- those three had nothing of their own to point at and were aimed at the nearest thing that
-- existed. That migration says so itself: *"Creator content moves like social content, but the
-- approval loop differs"* and *"WF-01 is a placeholder and this is the category most likely to want
-- a template of its own."* Influencer work has run on the SOCIAL CONTENT template ever since.
--
-- EVERY STEP IS DERIVED FROM THE AGENCY'S OWN BRIEF TEMPLATES, field by field — not from research,
-- which Edward ruled out explicitly. The Influencers Brief's Timeline field states the workflow in
-- the deck's own words: *"Creator briefing, drafts received, client approval, go live."* Each
-- template's source is named in the comment above it.
--
-- WF-15 AND WF-16 ARE A SPLIT, and the reason is arithmetic. Edward, 5 Sep: *"We often use more
-- than 1 external influencer."* Engagement work multiplies by CREATOR (two creators, two contracts)
-- and content work multiplies by ASSET (six stories, six edits). Two different quantities cannot
-- share one template run, so they are two lines on the brief — which needs no schema change,
-- because a template still runs exactly once per deliverable.
--
-- NOTE WF-15 REPEATS FIVE STEPS. That is the documented exception to the one-creation-step
-- convention (ADR-0071 d.8), not a mistake: outreach, contracting, briefing, seeding and going live
-- are each per creator. WF-19 repeats none, because a strategy document's quantity is always 1.
--
-- Bilingual at seed time (Edward, 5 Sep: *"Include the Arabic we will have it checked"*).
-- Idempotent throughout: a re-run adds what a tenant lacks and overwrites nothing they have edited.

begin;

create or replace function app.seed_tenant_i38_new_templates(p_tenant uuid) returns void
language plpgsql as $$
declare v_template uuid;
begin

  -- ---- WF-15 — Influencer Engagement ----
  -- Influencers Brief (deck 06) - Influencer Profile, Usage Rights & Exclusivity, Approval Flow, Timeline ("Creator briefing, drafts received, client approval, go live"), KPIs. ONE line on the brief, quantity = NUMBER OF CREATORS. INF-001 / 004 / 005 / 006.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-15', 'Influencer Engagement', 'التعاقد مع المؤثرين', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-15';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Creative Direction', 'التوجيه الإبداعي', 'digital', false),
    (2, 'Creator Shortlist', 'قائمة المؤثرين المرشحين', 'digital', false),
    (3, 'Outreach & Negotiation', 'التواصل والتفاوض', 'manual', true),
    (4, 'Contract & Usage Rights', 'العقد وحقوق الاستخدام', 'manual', true),
    (5, 'Creator Briefing', 'تبليغ المؤثر بالبريف', 'digital', true),
    (6, 'Seeding / Despatch', 'إرسال المنتجات للمؤثرين', 'manual', true),
    (7, 'Go Live', 'النشر', 'manual', true),
    (8, 'Performance Report', 'تقرير الأداء', 'digital', false)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;


  -- ---- WF-16 — Creator Content ----
  -- The content half of the Influencers Brief - Content Formats ("1 reel plus 3 stories each"). ONE line per FORMAT, quantity = NUMBER OF PIECES of that format. INF-002 / INF-003.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-16', 'Creator Content', 'محتوى صنّاع المحتوى', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-16';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Creative Direction', 'التوجيه الإبداعي', 'digital', false),
    (2, 'Creator Content', 'محتوى المؤثر', 'digital', true),
    (3, 'Amplification Assets', 'أصول التعزيز الإعلاني', 'digital', true)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;


  -- ---- WF-17 — Media & Performance ----
  -- Performance Brief (deck 04) - Tracking & Access, Platforms, Monthly Budget and flight dates, Target CPA/CPL/ROAS, Reporting. MED-001..006 are the deliverables it produces.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-17', 'Media & Performance', 'الإعلام والأداء', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-17';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Media Plan', 'الخطة الإعلامية', 'digital', false),
    (2, 'Tracking & Access Setup', 'إعداد التتبع والصلاحيات', 'manual', false),
    (3, 'Ad Creative', 'التصميم الإعلاني', 'digital', true),
    (4, 'Campaign Build', 'بناء الحملة', 'manual', false),
    (5, 'Launch', 'الإطلاق', 'manual', false),
    (6, 'Optimisation', 'التحسين', 'manual', false),
    (7, 'Performance Report', 'تقرير الأداء', 'digital', false)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;


  -- ---- WF-18 — Event / Activation ----
  -- Activation Brief (deck 03) - Activation Type, The Space, the four-stage journey (Attract / Engage / Amplify / Reward), Deliverables, Logistics & Permits, KPIs. EVT-001..012 are the deliverables it produces.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-18', 'Event / Activation', 'الفعاليات والتفعيل', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-18';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Creative Direction', 'التوجيه الإبداعي', 'digital', false),
    (2, 'Activation Concept', 'مفهوم التفعيل', 'digital', false),
    (3, 'Experience Journey', 'رحلة التجربة', 'digital', false),
    (4, 'Space & Build Design', 'تصميم المساحة والتنفيذ', 'digital', false),
    (5, 'Graphics & Collateral', 'الجرافيك والمواد المصاحبة', 'digital', true),
    (6, 'Logistics & Permits', 'اللوجستيات والتصاريح', 'manual', false),
    (7, 'Fabrication / Build', 'التصنيع والبناء', 'manual', false),
    (8, 'Staffing & Rehearsal', 'الطاقم والبروفة', 'manual', false),
    (9, 'Live Day', 'يوم الفعالية', 'manual', false),
    (10, 'Strike & Wrap Report', 'التفكيك وتقرير الختام', 'manual', false)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;


  -- ---- WF-19 — Strategy Document ----
  -- Creative Strategy Brief (09) and Communications Strategy Brief (10) - Background, Category & Competition, Positioning, Audience & Tension, Message Hierarchy, Territories, Measures. STR-011 / STR-013..017 are the deliverables it produces.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-19', 'Strategy Document', 'وثيقة الاستراتيجية', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-19';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Research & Audit', 'البحث والتدقيق', 'digital', false),
    (2, 'Category & Competition', 'الفئة والمنافسة', 'digital', false),
    (3, 'Audience & Insight', 'الجمهور والرؤية', 'digital', false),
    (4, 'Strategic Framework', 'الإطار الاستراتيجي', 'digital', false),
    (5, 'Document Build', 'إعداد الوثيقة', 'digital', false),
    (6, 'Handover / Presentation', 'التسليم والعرض', 'manual', false)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;


  -- ---- WF-20 — Digital Build ----
  -- NEW, decision 3. Derived from the Digital Build brief proposed on the "Digital Build brief" sheet. Covers DIG-001 / 002 / 003 / 004 / 012 / 013 / 014.
  insert into workflow_templates (tenant_id, code, name_en, name_ar, is_system)
  values (p_tenant, 'WF-20', 'Digital Build', 'البناء الرقمي', true)
  on conflict (tenant_id, code) do nothing;

  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-20';

  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template, n, en, ar, mode, per_unit from (values
    (1, 'Creative Direction', 'التوجيه الإبداعي', 'digital', false),
    (2, 'Discovery', 'الاستكشاف', 'digital', false),
    (3, 'UX / Wireframes', 'تجربة المستخدم والمخططات', 'digital', false),
    (4, 'UI Design', 'UI Design', 'digital', true),
    (5, 'Content Load', 'إدخال المحتوى', 'digital', false),
    (6, 'Build', 'البرمجة والتنفيذ', 'digital', false),
    (7, 'Integrations', 'الربط والتكاملات', 'manual', false),
    (8, 'QA & Testing', 'ضبط الجودة والاختبار', 'manual', false),
    (9, 'Launch', 'الإطلاق', 'manual', false),
    (10, 'Handover', 'التسليم والتدريب', 'manual', false)
  ) as g(n, en, ar, mode, per_unit)
  on conflict (tenant_id, template_id, sort_order) do nothing;

end $$;

comment on function app.seed_tenant_i38_new_templates(uuid) is
  'ADR-0071 d.5: the six templates for influencer engagement, creator content, media, events, '
  'strategy documents and digital builds — every step derived from the brief that orders the work. '
  'Idempotent on (tenant, code) and (tenant, template, sort_order).';

select app.seed_tenant_i38_new_templates(id) from tenants;

commit;
