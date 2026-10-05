-- Every deliverable type gets a default workflow template (ADR-0052, ADR-0051 d.3).
--
-- Edward, 29 Aug: *"not one single type creates a task list."* 0 of 269. The picker built that
-- morning works — RLS permits it, six tests cover it — but it asks a person to make 269 choices
-- before the feature does anything at all, so in practice it did nothing at all.
--
-- **I argued against this mapping yesterday and I was wrong.** The reasoning was that seeding a
-- default is "the system guessing on the tenant's behalf", against ADR-0051 d.3's seed-then-edit.
-- That gets d.3 backwards. Seeding a sensible default and letting the tenant change it IS
-- seed-then-edit — it is exactly what the 240 types, the 16 categories, the 48 attribute values and
-- the 14 templates themselves do. Leaving 269 nulls is not neutrality; it is shipping the feature
-- switched off and calling it a choice.
--
-- ============================================================================
-- ONLY FILLS BLANKS
-- ============================================================================
-- `where default_workflow_template_id is null`. A type somebody has already pointed at a template
-- keeps it, on this run and on every future one. The tenant's choice always outranks the seed.
--
-- ============================================================================
-- THE MAPPING, AND WHICH PARTS OF IT ARE GUESSES
-- ============================================================================
-- Defaults are set per CATEGORY, because that is the axis the templates were written along.
-- WF-11…WF-14 are deliberately NOT used: they are the four heavy production pipelines (Physical
-- Media, Ingest, Backup) and belong to types somebody chooses on purpose, not to a whole category.
--
-- Confident:
--   SOC → WF-02   VID → WF-03   PHO → WF-04   PRT → WF-05
--   PAC → WF-06   CAM → WF-08   ENV → WF-09   DIG → WF-01
--   STR / IDN / GUI → WF-07 Branding (Brief → Research → Strategy → Concept fits all three)
--
-- ⚠️ Judgement calls, flagged so they are reviewed rather than inherited. Each is one dropdown to
-- change on Admin → Deliverable types:
--   ADV → WF-01   Advertising spans print, film and OOH; Standard Digital is the least wrong.
--   CNT → WF-01   Content is writing; WF-01 opens Brief → Copy/Content → Design, which fits.
--   PRE → WF-01   A deck is assembled, not produced.
--   MER → WF-10   Merchandise is physical production, but lighter than WF-10 assumes.
--   EVT → WF-10   Could equally be WF-08 Campaign. Depends whether an event is run like a build
--                 or like a campaign in your agency — a question about you, not about the data.
--   INF → WF-02   Creator content moves like social content, but the approval loop differs.
--   MED → WF-01   Media plans and reports are not really "produced" at all; WF-01 is a placeholder
--                 and this is the category most likely to want a template of its own.
--   AUD → WF-03   Audio is not video, but Video Production is the only pipeline with a recording
--                 stage. A dedicated audio template is the honest fix.

begin;

create or replace function app.seed_tenant_default_workflows(p_tenant uuid) returns void
language plpgsql as $$
begin
  update deliverable_types dt
     set default_workflow_template_id = wt.id
    from (values
      ('STR', 'WF-07'), ('IDN', 'WF-07'), ('GUI', 'WF-07'),
      ('CAM', 'WF-08'), ('ADV', 'WF-01'), ('SOC', 'WF-02'),
      ('CNT', 'WF-01'), ('VID', 'WF-03'), ('PHO', 'WF-04'),
      ('DIG', 'WF-01'), ('PRT', 'WF-05'), ('PAC', 'WF-06'),
      ('ENV', 'WF-09'), ('PRE', 'WF-01'), ('MER', 'WF-10'),
      ('EVT', 'WF-10'), ('INF', 'WF-02'), ('MED', 'WF-01'),
      ('AUD', 'WF-03')
    ) as m(cat, tpl)
    join workflow_templates wt
      on wt.tenant_id = p_tenant and wt.code = m.tpl and wt.is_active
   where dt.tenant_id = p_tenant
     and dt.category_code = m.cat
     -- The whole guarantee: blanks only. A choice already made is never overwritten.
     and dt.default_workflow_template_id is null;
end $$;

comment on function app.seed_tenant_default_workflows(uuid) is
  'ADR-0052: give every deliverable type a default workflow template, by category, so choosing a '
  'type actually creates a task list. Fills BLANKS ONLY — a type already pointed at a template '
  'keeps it, which is what makes this seed-then-edit rather than an override.';

-- Existing tenants.
select app.seed_tenant_default_workflows(id) from tenants;

-- Future tenants. Reproduced from the CURRENT wrapper
-- (20260829120000_taxonomy_amendments.sql:135). This one runs LAST on purpose: it can only fill a
-- type's template once both the types and the templates exist.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

commit;
