-- I16.2/I16.4 — a department has a brief template, and a template has a name.
--
-- Edward, 30 Aug, after two wrong turns of mine: *"this is a multitenant system, so we need to
-- accept not everyone uses the same org structure and names their departments differently. We also
-- need to be able to create new templates and assign them as required."*
--
-- **What I got wrong, recorded so it is not repeated.** I first added a campaign-wide brief type to
-- wizard step 1 — before any deliverable exists, when nothing can yet know which briefs are needed.
-- ADR-0048 d.5 already says the opposite: *"the distinct disciplines in the final, human-confirmed
-- list decide which briefs get generated"*, each from *that discipline's* template. Then I proposed
-- seeding a department→template mapping by NAME, which only works if every tenant calls their
-- departments the same thing. It is a link the tenant sets, and nothing else.
--
-- THREE THINGS HERE.
--
-- 1. `departments.brief_template_id`. Nullable, nothing seeded, nothing guessed. A department that
--    never owns a deliverable never needs one; a department that does gets one set once.
--
-- 2. `brief_templates.name_en` / `name_ar`. The titles lived in the FRONTEND as i18n keys
--    (`campaigns.briefType.*`), which cannot work the moment a tenant creates a template of their
--    own — there is no key to add without a release. And the names were wrong anyway: the deck says
--    **CREATIVE BRIEF**, the app said "360 Campaign"; the deck says **PERFORMANCE BRIEF**, the app
--    said "Paid media / performance". Seeded here from the agency brief-template deck itself,
--    **including its Arabic**, which is the agency's own wording rather than the machine-generated
--    MSA the rest of the seed carries pending review (I18.8).
--
-- 3. The template a brief was written from is now reachable from the department, so generation
--    needs no picker anywhere — which is the whole point.

begin;

-- ============================================================================
-- 1) a template has a name of its own
-- ============================================================================
alter table brief_templates
  add column if not exists name_en text,
  add column if not exists name_ar text;

comment on column brief_templates.name_en is
  'What this brief is called, in the tenant''s own words. Held as DATA, not as an i18n key: a '
  'template the tenant creates has no key and never will. Seeded from the deck''s own titles.';
comment on column brief_templates.name_ar is
  'The Arabic title. For the eight seeded from the agency brief-template deck this is the DECK''S OWN '
  'Arabic, not machine-generated — those slides are bilingual and the agency wrote both halves.';

-- The deck's titles, verbatim from the agency brief-template deck slide 1 and each brief's cover.
-- Only rows that still have no name: a tenant who has renamed one keeps their wording.
update brief_templates set name_en = v.en, name_ar = v.ar
  from (values
    ('360',                     'Creative Brief',          'بريف إبداعي — حملات ٣٦٠'),
    ('social_calendar',         'Social Media Brief',      'بريف السوشيال ميديا'),
    ('activation',              'Activation Brief',        'بريف التفعيل'),
    ('paid_media',              'Performance Brief',       'بريف الإعلانات الممولة'),
    ('production',              'Production Brief',        'بريف الإنتاج'),
    ('influencer',              'Influencers Brief',       'بريف المؤثرين'),
    ('single_execution',        'Execution Brief',         'بريف تنفيذي'),
    -- Edward's four. Not in the deck — authored in docs/reference/brief-templates-additional.md,
    -- and their Arabic is the first draft awaiting a native reader (I18.8), unlike the seven above.
    ('creative_strategy',       'Creative Strategy Brief',       'بريف الاستراتيجية الإبداعية'),
    ('communications_strategy', 'Communications Strategy Brief',  'بريف استراتيجية التواصل'),
    ('brand_guidelines',        'Brand Guidelines Brief',         'بريف دليل الهوية'),
    ('custom',                  'Custom Brief',                   'بريف مخصص')
  ) as v(brief_type, en, ar)
 where brief_templates.brief_type = v.brief_type
   and brief_templates.name_en is null;

-- Anything a tenant added before this column existed keeps working: the key is the fallback name,
-- so nothing renders blank while somebody gets round to naming it.
update brief_templates set name_en = brief_type where name_en is null;

-- ============================================================================
-- 2) a department points at the template its briefs are written from
-- ============================================================================
-- **On the DEPARTMENT, not on the template**, so two departments can share one. A tenant with
-- "Content" and "Social" both writing to the Social brief is ordinary, and putting the link on the
-- template would cap each at a single department. The Templates screen still presents it the way
-- Edward asked — a template listing the departments assigned to it — which is a presentation
-- choice this column supports and the other direction would forbid.
-- NO inline `references` here. The composite FK below is the one that fences the tenant, and
-- declaring both would give PostgREST TWO relationships between these tables — every embed then
-- fails as ambiguous, which is a runtime error rather than a schema opinion.
alter table departments
  add column if not exists brief_template_id uuid;

comment on column departments.brief_template_id is
  'ADR-0048 d.5: which brief template this department''s campaign briefs are written from. NULL for '
  'a department that owns no deliverables — most of them. Set by the tenant on Admin → Brief '
  'templates; never seeded and never inferred from the name, because no two tenants name their '
  'departments alike.';

create index if not exists idx_departments_brief_template on departments (brief_template_id);

-- The tenant fence. A department must not point at another tenant's template, and FKs ignore RLS,
-- so a composite FK is the only thing that can enforce it — the same pattern deliverable_types →
-- deliverable_categories and workflow_steps → workflow_templates already use.
alter table brief_templates
  add constraint uq_brief_templates_tenant_id_id unique (tenant_id, id);

alter table departments
  add constraint fk_departments_brief_template
  foreign key (tenant_id, brief_template_id) references brief_templates (tenant_id, id);

-- Named in every embed (`brief_templates!fk_departments_brief_template(...)`), because a composite
-- FK is not something PostgREST will guess at.

commit;
