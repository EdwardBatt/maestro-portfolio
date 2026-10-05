-- ADR-0050: a deliverable has an OWNER, and a brief belongs to a department — one per campaign.
-- Its department was DERIVED from the owner and restamped whenever the owner changed; ADR-0099 d.2
-- supersedes that. The department is the deliverable's own and is CHOSEN — defaulted from the
-- owner once, at creation, and moved by nobody afterwards.
--
-- The assertion that matters most is 9: **cross-department sub-task assignment still works**.
-- That is not a new feature here, it is a regression guard. ADR-0050 d.9 promises this ADR
-- narrows no existing permission, and Edward asked directly whether any of this would disturb
-- what his agency does today. A promise nobody tests is a hope.

begin;
select plan(11);
\ir helpers/seed.sql

reset role;

-- The fixture's people all share one department, so this makes two real ones: Art & Video (where
-- the deliverable's owner sits) and Production (where a cross-department sub-task will sit).
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000060d1','aaaaaaaa-0000-0000-0000-000000000001','Art & Video'),
  ('aaaaaaaa-0000-0000-0000-0000000060d2','aaaaaaaa-0000-0000-0000-000000000001','Production');
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000060d1'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into deliverables (id, tenant_id, job_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000060e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Hero film');

-- --------------------------- the department is the deliverable's OWN (ADR-0099 d.2) ----
-- These four assertions tested ADR-0050 d.2 — "derive-don't-ask", the department stamped from the
-- owner and restamped whenever the owner changed. That rule is SUPERSEDED. It is what moved a
-- deliverable's department when its owner was changed and refused a Creative lead her own team
-- member on 22 Sep (I53.29). What replaces it: the owner supplies a DEFAULT once, at creation, and
-- a choice always wins; nothing restamps afterwards.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000060e1'),
  null, 'a deliverable created with no owner has no department to default from');

-- ADR-0102 (24 Sep) restores the derivation for a deliverable: its department is its OWNER's, set
-- whenever the owner changes and never chosen separately. (ADR-0099 had stopped it after the 22 Sep
-- fault; ADR-0098 has since made reach independent of the department, so the move refuses nobody.)
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-0000000060e1';
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000060e1'),
  (select department_id from user_profiles where id = '00000000-0000-0000-0000-00000000a003'),
  'naming an owner moves the work to their department (ADR-0102 d.1)');

-- A department that disagrees with the owner is not a choice any more: the write is put back.
update deliverables
   set department_id = 'aaaaaaaa-0000-0000-0000-0000000060d2'
 where id = 'aaaaaaaa-0000-0000-0000-0000000060e1';
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000060e1'),
  (select department_id from user_profiles where id = '00000000-0000-0000-0000-00000000a003'),
  'a department that disagrees with the owner is put back to the owner''s — never chosen (ADR-0102 d.1)');

-- Changing the owner takes the work with them.
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a002'
 where id = 'aaaaaaaa-0000-0000-0000-0000000060e1';
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000060e1'),
  (select department_id from user_profiles where id = '00000000-0000-0000-0000-00000000a002'),
  'and a new owner takes the work to theirs');

-- ------------------------------------- one brief per department ----
insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
   'aaaaaaaa-0000-0000-0000-0000000060d1','production');

select throws_ok($$
  insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
          'aaaaaaaa-0000-0000-0000-0000000060d1','single_execution')
$$, '23505', null,
  'ONE brief per department per campaign — six deliverables for one department is one brief');

select throws_ok($$
  insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, values)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001',
          'aaaaaaaa-0000-0000-0000-0000000060d2','production','[]'::jsonb)
$$, '23514', null, 'values must be a JSON object, not an array');

-- ------------------------------------- RLS ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select is(
  (select count(*)::int from campaign_briefs), 1,
  'a tenant member reads their tenant''s briefs — a brief exists to be read');

select is(
  (select count(*)::int from campaign_briefs
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002'), 0,
  'and cannot see another tenant''s');

-- ------------------------------------- THE REGRESSION GUARD (d.9) ----
-- Edward asked directly whether any of this disturbs his agency's current permissions. It must
-- not. A sub-task carries its OWN department and team, derived from its assignee, and never
-- inherits them from its deliverable — so an Art & Video deliverable can carry a Production
-- overlay task, exactly as before.
reset role;

-- The guard needs the deliverable and its task in DIFFERENT departments, so the work goes back to
-- Art & Video. Under ADR-0099 d.2 that is simply a choice being made — the same choice assertion 3
-- above proves is allowed. It is made BEFORE the task exists because an UNASSIGNED task follows
-- its deliverable's department (I53.29); this line is fixture, not what is being asserted.
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-0000000060d1'
 where id = 'aaaaaaaa-0000-0000-0000-0000000060e1';

insert into sub_tasks (id, tenant_id, deliverable_id, title, status, department_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000060a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000060e1','Streaming overlays','todo',
   'aaaaaaaa-0000-0000-0000-0000000060d2', 8);

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000060a1'
$$, 'a sub-task can still be assigned ACROSS departments — nothing here narrowed that');

reset role;
select is(
  (select count(*)::int from sub_tasks
    where id = 'aaaaaaaa-0000-0000-0000-0000000060a1'
      and assignee_id = '00000000-0000-0000-0000-00000000a003'), 1,
  'and it actually landed — not a vacuous pass on a row that was never there');

select isnt(
  (select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000060a1'),
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000060e1'),
  'the sub-task keeps its OWN department — it never inherits its deliverable''s');

select * from finish();
rollback;
