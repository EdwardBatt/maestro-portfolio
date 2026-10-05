-- I51.1 / I51.3 — every row says who made it and who last changed it; an approved brief is locked.
--
-- Two standing rules and one reversal, each proved rather than remembered:
--
--   * EVERY tenant-scoped table carries `created_by` and `updated_by` and the trigger that fills
--     them — asserted over the catalogue exactly as 092 asserts the audit trigger, so the next
--     table without them fails the build instead of quietly joining the 46 that lacked them.
--   * The trigger attributes to the SIGNED-IN user: an insert is the inserter's, an update the
--     updater's (two different people on the brief below), and a caller cannot claim to be
--     somebody else on update.
--   * ADR-0070 addendum (16 Sep): `campaign_briefs` UPDATE is projects:manage IN SCOPE and only
--     while unapproved. Another department's lead writes nothing; the department's own lead writes
--     nothing once it is approved; `reopen_department_brief` — the approver's authority — unlocks
--     it, is recorded, and the edit then lands.
--
-- Every write below runs as `authenticated` with the caller's own claims: the assertions are about
-- RLS and auth.uid(), and a superuser run would prove neither.
begin;
select plan(20);
\ir helpers/seed.sql
select app.seed_tenant_brief_approval_grants(id) from tenants;

-- ---------------------------------------------------------------- the standing rule ----
select is_empty($$
  select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and not a.attisdropped
                    and a.attname in ('tenant_id', 'host_tenant_id'))
     and c.relname not in ('audit_events', 'sla_events', 'notifications', 'messages')
     and not (
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'created_by' and not a.attisdropped)
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'updated_by' and not a.attisdropped))
$$, 'every tenant-scoped table carries created_by AND updated_by — the standing rule, enforced');

select is_empty($$
  select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and exists (select 1 from pg_attribute a
                  where a.attrelid = c.oid and not a.attisdropped
                    and a.attname in ('tenant_id', 'host_tenant_id'))
     and c.relname not in ('audit_events', 'sla_events', 'notifications', 'messages')
     and not exists (select 1 from pg_trigger tg
                      where tg.tgrelid = c.oid and tg.tgname = 'set_actor_columns' and not tg.tgisinternal)
$$, 'and every one of them fills the two columns by trigger, not by remembering to');

-- ---------------------------------------------------------------- who is written ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');

select is(
  (select created_by from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'an insert is attributed to the signed-in user, without the caller naming themself');
select is(
  (select updated_by from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de001'),
  null, 'a row nobody has changed says so — updated_by is null until an update');

-- The admin renames it (only an org-manage holder may; the brief section below proves attribution
-- across two different people).
update departments set name = 'Creative Studio' where id = 'aaaaaaaa-0000-0000-0000-0000000de001';
select is(
  (select updated_by from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'an update is attributed to the person who made it');
select is(
  (select created_by from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'and created_by is untouched by later edits');

-- The caller cannot launder an edit: a claimed updated_by is overwritten with who they are.
update departments set name = 'Creative', updated_by = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-0000000de001';
select is(
  (select updated_by from departments where id = 'aaaaaaaa-0000-0000-0000-0000000de001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'updated_by is who the database saw, never who the caller wrote');

-- ---------------------------------------------------------------- the list shows it ----
select has_column('public','campaign_list_rows','created_by_name','the campaigns list names who started each');
select has_column('public','campaign_list_rows','updated_by_name','and who last edited it');

reset role;
-- ---------------------------------------------------------------- an approved brief is locked ----
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values) values
  ('aaaaaaaa-0000-0000-0000-0000000cb001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000de001','creative','{"task":"v1"}'),
  ('aaaaaaaa-0000-0000-0000-0000000cb002','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-0000000de002','production','{"task":"v1"}');

-- a003 becomes Creative's department lead: holds projects:manage AND briefs:approve, reach = Creative.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

select ok(app.has_permission('projects', 'manage'),
  'fixture check: the Creative lead holds projects:manage — the permission was never the question');

-- Their own, unapproved: the edit lands.
update campaign_briefs set values = '{"task":"v2"}' where id = 'aaaaaaaa-0000-0000-0000-0000000cb001';
select is(
  (select values ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  'v2', 'the department''s own lead edits its unapproved brief');
select is(
  (select updated_by from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'and the brief says who changed it');

-- Production's brief: out of reach. RLS filters the row, so the update touches nothing.
update campaign_briefs set values = '{"task":"hijacked"}' where id = 'aaaaaaaa-0000-0000-0000-0000000cb002';
select is(
  (select values ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb002'),
  'v1', 'a Creative lead writes NOTHING on Production''s brief — the scope test update never had');

-- Approve their own, then try to edit it.
select lives_ok($$ select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001') $$,
  'the Creative lead approves Creative''s brief');
update campaign_briefs set values = '{"task":"v3"}' where id = 'aaaaaaaa-0000-0000-0000-0000000cb001';
select is(
  (select values ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  'v2', 'an APPROVED brief is locked — even to the lead who approved it (ADR-0070 addendum, reversing d.8)');

-- Re-open: the approver's authority, and nobody else's.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
-- a002 is tenant-wide (Traffic) and may; first prove a stranger may not, via a Team Member seat.
reset role;
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member')
 where id = '00000000-0000-0000-0000-00000000a002';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$ select public.reopen_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001') $$,
  '42501', null, 'somebody who could not approve it cannot re-open it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ select public.reopen_department_brief('aaaaaaaa-0000-0000-0000-0000000cb001') $$,
  'the approver re-opens it');
select is(
  (select approved_at from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  null, 'and the approval is cleared — new assignments wait again (d.4)');

update campaign_briefs set values = '{"task":"v3"}' where id = 'aaaaaaaa-0000-0000-0000-0000000cb001';
select is(
  (select values ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb001'),
  'v3', 'then the edit lands');

reset role;
select isnt_empty($$
  select 1 from audit_events
   where entity = 'campaign_briefs' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000cb001'
     and action = 'department_brief_reopened'
     and actor_user_id = '00000000-0000-0000-0000-00000000a003'
$$, 'the re-opening is its own audit line, naming who did it');

select * from finish();
rollback;
