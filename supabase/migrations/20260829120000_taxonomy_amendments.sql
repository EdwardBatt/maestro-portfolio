-- Taxonomy amendments approved by Edward, 29 Aug 2026 (ADR-0051 d.3 — seed-then-edit, exercised).
--
-- The seeded 240 were a starting point, not a contract. A day of real use against a real brief
-- found nine ambiguous pairs and thirty deliverables the list could not name. Edward reviewed the
-- proposal row by row; this is what he approved.
--
--   3 new categories   INF Influencer & Creator · MED Media & Performance · AUD Audio
--   29 new types       12 in existing categories, 17 in the new ones
--   2 renames          Newsletter appeared three times and two of them were under-named
--   3 deactivations    the same artefact filed in two places; the duplicate goes
--
-- **The finding behind the new categories.** The pilot's `INFLUENCERS` department had ZERO
-- deliverable types — an entire department could not classify a single thing it makes, so none of
-- its work materialised a task list. `PERFORMANCE` was nearly as bare, and there was no home for
-- audio at all.
--
-- ============================================================================
-- WHY A SECOND SEED FUNCTION RATHER THAN EDITING THE FIRST
-- ============================================================================
-- `app.seed_tenant_deliverable_taxonomy` (20260828160000) is GENERATED from
-- `docs/reference/seed-vocabulary-bilingual.md`, and its own header says to regenerate rather than
-- edit it. There is no generator script in this repository, so editing 240 rows by hand to add 29
-- is exactly the transcription risk that file exists to avoid.
--
-- So the baseline stays the reviewed artefact and the amendments are their own function, chained
-- into the provisioning wrapper after it. That also keeps the provenance readable: these rows came
-- from one review on one date, and a future reader can see which.
--
-- ARABIC IS MACHINE-GENERATED MSA, pending a native speaker — the same debt `I18.8` records against
-- the seeded 472 rows. `name_ar` is nullable and every surface falls back to English, so an
-- unreviewed row is a visible gap rather than a blocked screen. Approving the English did not
-- approve the Arabic, and Edward was told so.
--
-- NOT INCLUDED, deliberately: six of the nine ambiguous pairs (A1–A6 — Reel, Short-form Video,
-- Long-form Video, Social Advertisement, Print Advertisement, Billboard) are still undecided. They
-- change nothing until decided, so they wait rather than being guessed.

begin;

create or replace function app.seed_tenant_taxonomy_amendments(p_tenant uuid) returns void
language plpgsql as $$
begin
  -- ------------------------------------------------------------- categories ----
  -- Sort orders continue the base seed's series, which ends at EVENTS/160.
  insert into deliverable_categories (tenant_id, code, name_en, name_ar, sort_order)
  select p_tenant, c, en, ar, ord from (values
    ('INF', 'INFLUENCER & CREATOR', 'المؤثرون وصنّاع المحتوى', 170),
    ('MED', 'MEDIA & PERFORMANCE',  'الإعلام والأداء',          180),
    ('AUD', 'AUDIO',                'الصوتيات',                 190)
  ) as g(c, en, ar, ord)
  on conflict (tenant_id, code) do nothing;

  -- ------------------------------------------------------------------ types ----
  insert into deliverable_types (tenant_id, code, category_code, name_en, name_ar)
  select p_tenant, c, cat, en, ar from (values
    -- Part B — existing categories. The strategy cluster (STR-013…017) came from Edward noticing
    -- Communications Strategy was absent; checking its neighbours turned one gap into five.
    ('STR-013', 'STR', 'Communications Strategy', 'استراتيجية الاتصال'),
    ('STR-014', 'STR', 'Content Strategy',        'استراتيجية المحتوى'),
    ('STR-015', 'STR', 'Social Media Strategy',   'استراتيجية وسائل التواصل الاجتماعي'),
    ('STR-016', 'STR', 'Channel Strategy',        'استراتيجية القنوات'),
    ('STR-017', 'STR', 'Go-to-Market Strategy',   'استراتيجية الطرح في السوق'),
    ('CAM-011', 'CAM', 'Campaign Report',         'تقرير الحملة'),
    -- The gap found live: PRT-018 "Calendar" is a PRINTED calendar between Menu and Sticker.
    ('CNT-021', 'CNT', 'Content Calendar',        'تقويم المحتوى'),
    ('CNT-022', 'CNT', 'Translation',             'ترجمة'),
    -- Kurdish subtitles were a stated requirement of the pilot's own brief and unnameable.
    ('VID-024', 'VID', 'Subtitles',               'ترجمة نصية'),
    -- CNT-018 Voiceover Script existed; the recording did not. Different craft, different person.
    ('VID-025', 'VID', 'Voiceover Recording',     'تسجيل التعليق الصوتي'),
    ('DIG-016', 'DIG', 'SEO Audit',               'تدقيق تحسين محركات البحث'),
    ('DIG-017', 'DIG', 'Analytics Dashboard',     'لوحة تحليلات'),

    -- Part C — the three departments the taxonomy could not describe.
    ('INF-001', 'INF', 'Influencer Brief',        'موجز المؤثر'),
    ('INF-002', 'INF', 'Creator Content',         'محتوى صانع المحتوى'),
    ('INF-003', 'INF', 'UGC Video',               'فيديو من إنتاج المستخدمين'),
    ('INF-004', 'INF', 'Ambassador Kit',          'حقيبة السفير'),
    ('INF-005', 'INF', 'Seeding Kit',             'حقيبة التوزيع'),
    ('INF-006', 'INF', 'Influencer Report',       'تقرير المؤثرين'),

    ('MED-001', 'MED', 'Media Plan',              'خطة إعلامية'),
    ('MED-002', 'MED', 'Media Schedule',          'جدول إعلامي'),
    ('MED-003', 'MED', 'Paid Social Asset',       'أصل إعلاني مدفوع لوسائل التواصل'),
    ('MED-004', 'MED', 'Search Advertisement',    'إعلان البحث'),
    ('MED-005', 'MED', 'Display Campaign',        'حملة إعلانات العرض'),
    ('MED-006', 'MED', 'Performance Report',      'تقرير الأداء'),

    ('AUD-001', 'AUD', 'Podcast Episode',         'حلقة بودكاست'),
    ('AUD-002', 'AUD', 'Podcast Cover',           'غلاف البودكاست'),
    ('AUD-003', 'AUD', 'Jingle',                  'لحن إعلاني'),
    ('AUD-004', 'AUD', 'Sonic Logo',              'الشعار الصوتي'),
    ('AUD-005', 'AUD', 'Audio Advertisement',     'إعلان صوتي')
  ) as g(c, cat, en, ar)
  on conflict (tenant_id, code) do nothing;

  -- ---------------------------------------------------------------- renames ----
  -- "Newsletter" named three different deliverables: the copy (CNT-015), the printed piece
  -- (PRT-009) and the email template (DIG-008, already named well). Not ambiguity — under-naming.
  -- All three are real, so the two vague ones are renamed rather than deactivated.
  --
  -- Guarded on the CURRENT name, so a tenant that has already renamed one keeps its own wording.
  -- Seed-then-edit means the tenant's edit outranks ours (ADR-0051 d.3).
  update deliverable_types
     set name_en = 'Newsletter Copy', name_ar = 'نص النشرة الإخبارية'
   where tenant_id = p_tenant and code = 'CNT-015' and name_en = 'Newsletter';

  update deliverable_types
     set name_en = 'Printed Newsletter', name_ar = 'نشرة إخبارية مطبوعة'
   where tenant_id = p_tenant and code = 'PRT-009' and name_en = 'Newsletter';

  -- ----------------------------------------------------------- deactivations ----
  -- Three of the nine ambiguous pairs, resolved. DEACTIVATED, never deleted: a type is a record of
  -- what was agreed on work already done, deliverables already carrying it keep displaying it, and
  -- the FK from `deliverables` would refuse a delete anyway (ADR-0051 d.13).
  --
  --   STR-012 Campaign Strategy  → CAM-001 keeps it. Everything else in CAM- is campaign-scoped.
  --   ENV-006 Event Branding     → EVT-010 keeps it. An event's branding is scoped by the event.
  --   VID-013 Event Video        → EVT-012 keeps it. Same reasoning.
  update deliverable_types
     set is_active = false
   where tenant_id = p_tenant and code in ('STR-012', 'ENV-006', 'VID-013');
end $$;

comment on function app.seed_tenant_taxonomy_amendments(uuid) is
  'Taxonomy amendments approved 29 Aug 2026: 3 categories (INF/MED/AUD), 29 types, 2 renames and '
  '3 deactivations resolving duplicate names. Separate from seed_tenant_deliverable_taxonomy '
  'because that function is GENERATED and says to regenerate rather than edit it. Idempotent; '
  'renames are guarded on the current value so a tenant''s own edit is never overwritten.';

-- Existing tenants.
select app.seed_tenant_taxonomy_amendments(id) from tenants;

-- Future tenants. Reproduced from the CURRENT wrapper (20260829110000_retire_work_types.sql:171),
-- which calls roles, brief templates, the taxonomy and workflow templates — the disciplines seeder
-- having gone with `work_types`. Copying an older version would silently drop one of those from
-- provisioning, and nobody would find out until the next customer opened a screen that needed it.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

commit;
