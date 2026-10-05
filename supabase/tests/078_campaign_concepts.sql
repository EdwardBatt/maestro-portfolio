-- I34.1 (ADR-0065 d.6, d.7, d.8) — a proposed concept is fenced like the brief it answers, and
-- cannot be rewritten after the fact.
--
-- Two properties carry this table. The first is ordinary and must still be proved: tenant
-- isolation, and a write grant that matches `campaign_briefs` rather than being wider. The second
-- is the unusual one — a set is IMMUTABLE. There is no UPDATE policy and `update` is revoked, so
-- the row stays the record of what the model actually proposed. That matters because ADR-0065 d.2
-- makes "did it generate a fact that was not in the brief?" a question somebody may have to answer
-- later, and an editable row cannot answer it.
--
-- Every case runs as `authenticated` with the caller's own JWT claims, never as superuser: the
-- policies read `app.current_tenant_id()` and `app.has_permission()`, so a superuser run would
-- prove nothing at all.
begin;
select plan(14);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra fixtures ----
-- The shared seed has no departments, and a brief is keyed by one.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000dd001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('bbbbbbbb-0000-0000-0000-0000000dd001','bbbbbbbb-0000-0000-0000-000000000001','Creative B');

insert into campaigns (id, tenant_id, client_id, name, status) values
  ('bbbbbbbb-0000-0000-0000-00000000e001','bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000c001','B Campaign','approved');

insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000bb001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000dd001','creative','{}'),
  ('bbbbbbbb-0000-0000-0000-0000000bb001','bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000e001','bbbbbbbb-0000-0000-0000-0000000dd001','creative','{}');

insert into campaign_concepts (id, tenant_id, campaign_brief_id, proposals, model) values
  ('aaaaaaaa-0000-0000-0000-0000000cc001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000bb001','[{"shape":"pillars","answers":["objective"]}]','gpt-5.6-luna'),
  ('bbbbbbbb-0000-0000-0000-0000000cc001','bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-0000000bb001','[]','gpt-5.6-luna');

-- ---------------------------------------------------------------- shape ----
select has_table('public','campaign_concepts','the table exists');
select col_not_null('public','campaign_concepts','tenant_id','tenant_id is NOT NULL — no unfenced row');

-- Addendum d.10 (13 Sep) REVERSES d.8: ONE working concept per brief, refined in place. The unique
-- constraint that d.8 forbade is now the rule; regeneration fills slots, it does not add a set.
select isnt_empty($$
  select 1 from pg_constraint c
   where c.conrelid = 'campaign_concepts'::regclass and c.contype = 'u'
     and c.conkey @> array[(select attnum from pg_attribute
                             where attrelid='campaign_concepts'::regclass and attname='campaign_brief_id')]
$$, 'ONE concept per brief — unique on the brief (addendum d.10)');

select throws_ok($$
  insert into campaign_concepts (tenant_id, campaign_brief_id, proposals, model)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000bb001','{}','m')
$$, '23514', null, 'proposals must be a JSON ARRAY — an object is refused by the check constraint');

-- ---------------------------------------------------------------- read ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*) from campaign_concepts)::int, 1,
  'a Team Member with no projects:manage still READS — a concept exists to be read by the people doing the work');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*) from campaign_concepts where tenant_id='aaaaaaaa-0000-0000-0000-000000000001')::int, 0,
  'tenant B cannot see tenant A''s concepts');

-- ---------------------------------------------------------------- write ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
-- A second concept on a brief that has one is refused (d.10); a brief without one takes it.
select throws_ok($$
  insert into campaign_concepts (tenant_id, campaign_brief_id, proposals, model)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000bb001','[]','gpt-5.6-luna')
$$, '23505', null, 'a brief has ONE working concept — a second is refused (addendum d.10)');
select lives_ok($$
  delete from campaign_concepts where id = 'aaaaaaaa-0000-0000-0000-0000000cc001';
  insert into campaign_concepts (tenant_id, campaign_brief_id, proposals, model)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000bb001','[]','gpt-5.6-luna')
$$, 'projects:manage may propose — the same grant that already edits that brief (d.7)');

-- Stamped, not sent: a caller naming somebody else as the requester is simply overwritten.
select is(
  (select requested_by from campaign_concepts
    where campaign_brief_id = 'aaaaaaaa-0000-0000-0000-0000000bb001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'requested_by is stamped from auth.uid(), whatever the payload said');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  insert into campaign_concepts (tenant_id, campaign_brief_id, proposals, model)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000bb001','[]','gpt-5.6-luna')
$$, '42501', null, 'a reader without projects:manage may not propose');

-- Cross-tenant write with a forged tenant_id: the WITH CHECK fences it, not the caller's honesty.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($$
  insert into campaign_concepts (tenant_id, campaign_brief_id, proposals, model)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000bb001','[]','m')
$$, '42501', null, 'tenant B cannot write a concept into tenant A');

-- ---------------------------------------------------------------- refined in place ----
-- Addendum d.10 reverses the old "no update policy" assertion: a working concept is refined by a
-- person, so the grant that proposes may update — and a reader may not. Per-item operations are
-- exercised in 113.
select isnt_empty($$
  select 1 from pg_policies
   where tablename = 'campaign_concepts' and cmd = 'UPDATE'
$$, 'there IS an update policy — the concept is refined in place (addendum d.10)');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is_empty($$
  update campaign_concepts set model = 'edited'
   where campaign_brief_id = 'aaaaaaaa-0000-0000-0000-0000000bb001'
  returning 1
$$, 'a reader without projects:manage cannot change the concept');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$
  delete from campaign_concepts where campaign_brief_id = 'aaaaaaaa-0000-0000-0000-0000000bb001'
$$, 'discard IS still supported — an unwanted concept is deleted');

select * from finish();
rollback;
