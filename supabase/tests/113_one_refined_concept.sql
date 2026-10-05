-- ADR-0065 addendum (13 Sep) / I48.15 — one refined concept, not a history of sets.
--
-- Properties:
--   * the migration collapsed many sets to the newest, dropped content_types items, and gave every
--     item an id;
--   * keep marks an item; delete removes it and opens a slot in its shape (d.10/d.11);
--   * a reader without projects:manage can do neither; an unknown item is not found;
--   * bumping `regenerations` stamps who/when from auth.uid() (the per-press audit the addendum keeps).
begin;
select plan(11);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000dd113','aaaaaaaa-0000-0000-0000-000000000001','Creative 113');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000bb113','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000dd113','creative','{}');

-- The working concept: two pillars and one direction, ids on each.
insert into campaign_concepts (id, tenant_id, campaign_brief_id, proposals, model) values
  ('aaaaaaaa-0000-0000-0000-0000000cc113','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000bb113',
   '[{"id":"p1","shape":"pillars","name":"Warmth","text":"…","answers":[]},
     {"id":"p2","shape":"pillars","name":"Craft","text":"…","answers":[]},
     {"id":"d1","shape":"creative_direction","text":"…","answers":[]}]'::jsonb,
   'gpt-5.6-luna');

-- ---------------------------------------------------------------- shape ----
select has_column('public','campaign_concepts','slots','the slots opened by deletions (d.11)');
select has_column('public','campaign_concepts','regenerations','the regeneration count');
select has_function('public','campaign_concept_mark_item', array['uuid','text','text'], 'keep/delete goes through one RPC');

-- ---------------------------------------------------------------- a reader cannot ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  select public.campaign_concept_mark_item('aaaaaaaa-0000-0000-0000-0000000cc113', 'p1', 'delete')
$$, '42501', null, 'a reader without projects:manage cannot delete an item');

-- ---------------------------------------------------------------- keep ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$
  select public.campaign_concept_mark_item('aaaaaaaa-0000-0000-0000-0000000cc113', 'p1', 'keep')
$$, 'projects:manage keeps an item');
select is(
  (select (item ->> 'kept')::boolean from campaign_concepts c, jsonb_array_elements(c.proposals) item
    where c.id = 'aaaaaaaa-0000-0000-0000-0000000cc113' and item ->> 'id' = 'p1'),
  true, 'the item is marked kept (d.10)');

-- ---------------------------------------------------------------- delete ----
select lives_ok($$
  select public.campaign_concept_mark_item('aaaaaaaa-0000-0000-0000-0000000cc113', 'p2', 'delete')
$$, 'and deletes another');
select results_eq($$
  select jsonb_array_length(proposals), (slots ->> 'pillars')::int
    from campaign_concepts where id = 'aaaaaaaa-0000-0000-0000-0000000cc113'
$$, $$ values (2, 1) $$, 'the item is gone and a pillars slot is open for regeneration (d.11)');

select throws_ok($$
  select public.campaign_concept_mark_item('aaaaaaaa-0000-0000-0000-0000000cc113', 'nope', 'delete')
$$, 'P0002', null, 'an unknown item is not found');

-- ---------------------------------------------------------------- the regeneration stamp ----
select lives_ok($$
  update campaign_concepts
     set proposals = proposals || '[{"id":"p3","shape":"pillars","name":"Play","text":"…","answers":[]}]'::jsonb,
         slots = '{}'::jsonb,
         regenerations = regenerations + 1
   where id = 'aaaaaaaa-0000-0000-0000-0000000cc113'
$$, 'a regeneration fills the slot and bumps the count');
select results_eq($$
  select regenerated_by, regenerated_at is not null, slots
    from campaign_concepts where id = 'aaaaaaaa-0000-0000-0000-0000000cc113'
$$, $$ values ('00000000-0000-0000-0000-00000000a001'::uuid, true, '{}'::jsonb) $$,
  'who regenerated and when are stamped from auth.uid(), and the slots are reset');

select * from finish();
rollback;
