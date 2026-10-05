-- I38 (ADR-0071) — what the seven seed migrations actually did.
--
-- The 28 August seeds shipped with no assertions of their own, which is how `WF-11..WF-14 mapped to
-- zero types` and `the unique index was never created` both survived a week. This suite asserts the
-- shape of every I38 seed against the accepted mapping sheet, so the next person changing a
-- template finds out here rather than in production.

begin;
select plan(19);
\ir helpers/seed.sql

-- The shared seed builds a tenant WITHOUT running the provisioning wrapper, so it has no taxonomy
-- and no templates at all. Everything I38 seeds arrives through `public.seed_tenant_roles`, so this
-- suite provisions its own tenant the way 070 does — which also proves, in passing, that the
-- wrapper picks up the six new seeds (20260905090800). A tenant created tomorrow must get the same
-- product as the ones alive when the migrations were applied.
insert into tenants (id, name, slug) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'Tenant E (I38)', 'tenant-e');
select lives_ok(
  $$select public.seed_tenant_roles('eeeeeeee-0000-0000-0000-000000000001')$$,
  'provisioning a brand-new tenant succeeds with all six I38 seeds in the wrapper');

-- ============================================================ deactivations (d.2)
select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and code in ('SOC-005','SOC-006','SOC-009','VID-008','PRT-016','ENV-010',
                   'STR-001','STR-003','STR-004')
      and is_active),
  0, 'the nine duplicate and unordered types are switched off');

select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and code in ('SOC-004','VID-009','VID-010','ADV-003','ADV-001','ADV-006')),
  6, 'and the one KEPT from each duplicate pair is still there — deactivated, never deleted');

-- Edward, 5 Sep: the taxonomy is valuable long-term. Nothing is removed.
select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  269, 'all 269 rows survive: this migration deactivates, it does not delete');

-- The 17 identity types stay ACTIVE — decision 1 makes them a job's task list, and a logo can
-- still be sold alone through a Single Execution brief.
select is(
  (select count(*)::int from deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and category_code = 'IDN' and is_active),
  17, 'every BRAND IDENTITY type stays active (d.3)');

-- ============================================================ the new brief (d.4)
select is(
  (select jsonb_array_length(fields) from brief_templates
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001' and brief_type = 'digital_build'),
  13, 'the Digital Build brief has its 13 fields');

select ok(
  (select bool_and((f ->> 'ar') is not null and length(f ->> 'ar') > 0)
     from brief_templates bt, jsonb_array_elements(bt.fields) f
    where bt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and bt.brief_type = 'digital_build'),
  'and every one of them carries Arabic — this does not repeat the ADR-0051 d.6 English-only debt');

-- ============================================================ the new templates (d.5)
select is(
  (select count(*)::int from workflow_templates
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and code in ('WF-15','WF-16','WF-17','WF-18','WF-19','WF-20')),
  6, 'the six templates that had no workflow now exist');

select is(
  (select ws.title_en from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-15' and ws.repeats_per_unit
    order by ws.sort_order limit 1),
  'Outreach & Negotiation',
  'WF-15 repeats by CREATOR, not by artefact — the documented exception to the one-creation-step rule');

select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-19' and ws.repeats_per_unit),
  0, 'and WF-19 Strategy Document repeats nothing — its quantity is always 1');

-- ============================================================ naming + marking (d.7, d.8)
select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-02' and ws.title_en in ('Copy', 'Creative')),
  0, 'the craft labels that never said what they produced are gone from Social Content');

select is(
  (select ws.title_en from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-02' and ws.repeats_per_unit),
  'Create Content',
  'and the ONE step that repeats is the one named for creating the thing (Edward''s own test)');

-- ============================================================ Creative Direction (d.6)
select is(
  (select count(*)::int from workflow_templates wt
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code like 'WF-%' and wt.is_system
      and wt.code not in ('WF-17','WF-19')
      and not exists (select 1 from workflow_steps ws
                       where ws.template_id = wt.id and ws.title_en = 'Creative Direction')),
  0, 'every seeded template that makes something has Creative Direction — it had ONE of fourteen');

select is(
  (select ws.sort_order from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-07' and ws.title_en = 'Creative Direction'),
  3, 'on Branding it sits AFTER Research and Write Strategy — the confirmed exception (d.6)');

-- ============================================================ the components (d.3)
select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where wt.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
      and wt.code = 'WF-07'
      and ws.title_en in ('Logo','Logo System','Colour Palette','Typography System',
                          'Visual Language','Iconography','Photography Direction','Brand Pattern')),
  8, 'Branding carries the identity components as steps, not as 17 separate deliverables');

-- ============================================================ the mapping (d.1)
select is(
  (select count(*)::int from brief_deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  317, 'every row of the accepted mapping is seeded');

select is(
  (select count(distinct brief_type)::int from brief_deliverable_types
    where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'),
  11, 'across eleven brief types — the ten real ones plus the reserved campaign_360');

-- The social brief must offer Reel and must NOT be the route to a bottle. This is the whole point
-- of the table: before it, both sat in the same 269-row picker.
select ok(
  exists (select 1 from brief_deliverable_types b
            join deliverable_types dt on dt.id = b.deliverable_type_id
           where b.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
             and b.brief_type = 'social_calendar' and dt.code = 'SOC-004')
  and not exists (select 1 from brief_deliverable_types b
            join deliverable_types dt on dt.id = b.deliverable_type_id
           where b.tenant_id = 'eeeeeeee-0000-0000-0000-000000000001'
             and b.brief_type = 'social_calendar' and dt.code = 'PAC-007'),
  'the Social brief orders a Reel and does not order a Bottle');

-- Tenant isolation, the assertion every new table owes (AGENTS.md 6). Tenant D exists from 070's
-- fixture in the same run; nothing of E''s may be visible under D''s claims.
select is(
  (select count(*)::int from brief_deliverable_types
    where tenant_id <> 'eeeeeeee-0000-0000-0000-000000000001'
      and deliverable_type_id in (select id from deliverable_types
                                   where tenant_id = 'eeeeeeee-0000-0000-0000-000000000001')),
  0, 'no mapping row ever points at another tenant''s deliverable type');

select * from finish();
rollback;
