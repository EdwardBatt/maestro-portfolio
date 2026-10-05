-- ADR-0077 addendum d.7–d.8 (I48.35): starting any task under a Draft deliverable moves the
-- deliverable to In progress, with no authority beyond being the task's assignee — and so the
-- automatic sign-off (d.2) can fire without anybody pressing Start on the container.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (reviews:moderate), a003 = team_member
-- — who holds project_tasks:manage in the seed on purpose, so the "no authority" assertion below
-- is made as a004, a bare team member created here with nothing but the role.

begin;
select plan(8);
\ir helpers/seed.sql

reset role;

-- a bare team member: no project_tasks:manage, so the deliverable's own Start would be refused
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a004', 'maker-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select '00000000-0000-0000-0000-00000000a004', 'aaaaaaaa-0000-0000-0000-000000000001', 'Maker A',
       (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member');
delete from role_grants rg
 using roles r
 where rg.role_id = r.id and r.key = 'team_member' and rg.resource = 'project_tasks' and rg.action = 'manage';
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a004';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000116f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S116');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000116e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116f1','Launch copy','draft'),
  ('aaaaaaaa-0000-0000-0000-0000000116e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116f1','Untouched','draft');
-- two tasks on the first deliverable; the SECOND is the one started, so "any task" is what is proved
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000116a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116e1','Creative direction','00000000-0000-0000-0000-00000000a004','todo','digital', 8),
  ('aaaaaaaa-0000-0000-0000-0000000116a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116e1','Write copy','00000000-0000-0000-0000-00000000a004','todo','digital', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000116a1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000116a2','00000000-0000-0000-0000-00000000a001', true);

-- ================================================== 1. no authority for the container itself ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);

-- RLS keeps the maker off the deliverables table altogether (the update touches no row) and the
-- guard's d.8 branch would fall through even if it did not — either way the container is not theirs
-- to start by hand.
update deliverables set state = 'in_progress' where id = 'aaaaaaaa-0000-0000-0000-0000000116e1';
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000116e1'),
  'draft', 'a maker cannot press Start on the deliverable — nothing under it has started, so it stays Draft');

-- ================================================ 2-4. starting ANY task starts the container ====
select lives_ok($$select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000116a2')$$,
  'the maker starts the SECOND task');
select is((select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000116a2'),
  'in_progress', 'the task is in progress');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000116e1'),
  'in_progress', 'and its deliverable is In progress, moved by the maker with no authority of their own (d.7, d.8)');

-- ============================================================ 5. a sibling is untouched ====
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000116e2'),
  'draft', 'a deliverable with no started task stays Draft');

-- ============================================ 6-8. the close rule now has a state to read from ====
-- Both tasks submitted and approved; nobody presses Start on the container at any point.
reset role;
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000116c1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116e1','aaaaaaaa-0000-0000-0000-0000000116a1','k/a1.png','image/png'),
  ('aaaaaaaa-0000-0000-0000-0000000116c2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000116e1','aaaaaaaa-0000-0000-0000-0000000116a2','k/a2.png','image/png');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select app.sub_task_start('aaaaaaaa-0000-0000-0000-0000000116a1');
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000116a1', 30, true);
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000116a2', 30, true);

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000116a1');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000116e1'),
  'in_progress', 'one task approved: the deliverable is still open');
select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000116a2');
select is((select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000116a2'),
  'done', 'the last task is done');
select is((select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000116e1'),
  'approved', 'and the deliverable signed itself off — nobody pressed Start on it (d.2 via d.7)');

select * from finish();
rollback;
