-- ADR-0089 addendum d.14 (I48.37): one consolidated round — a send-back waits for every optional
-- answer, exactly as the completing approval does; the caller's own press is their answer.
--
-- Subjects (helpers/seed.sql, tenant A): a001 = power_admin (required reviewer), a003 = team_member
-- (the maker), a004 / a005 = team_lead moderators created here (optional reviewers).

begin;
select plan(9);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a004', 'lead-a@a.test'),
  ('00000000-0000-0000-0000-00000000a005', 'lead2-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'team_lead')
from (values
  ('00000000-0000-0000-0000-00000000a004', 'Lead A'),
  ('00000000-0000-0000-0000-00000000a005', 'Lead A2')
) as v(id, name);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
from user_profiles up
where up.id in ('00000000-0000-0000-0000-00000000a004', '00000000-0000-0000-0000-00000000a005');

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000117d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S117');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000117e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000117d1','KV117','in_progress');
-- one required (a001) and TWO optional (a004, a005) reviewers, task already submitted
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000117a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000117e1','00000000-0000-0000-0000-00000000a003','Task117','review','digital', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000117a1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000117a1','00000000-0000-0000-0000-00000000a004', false),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000117a1','00000000-0000-0000-0000-00000000a005', false);
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000117c1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000117e1','aaaaaaaa-0000-0000-0000-0000000117a1','k/v1.png','image/png');

-- ================================= 1-2. the required reviewer cannot send it back yet ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into review_feedback (tenant_id, media_record_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000117c1',
   'internal','Hero line too long.','00000000-0000-0000-0000-00000000a001');

select throws_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  '55089', null,
  'with two optional reviewers unanswered, the required reviewer''s send-back is refused (d.14)');
select throws_like(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  '%Lead A, Lead A2%',
  '… and the refusal names who has not answered');

-- ====================== 3-4. an optional reviewer's own send-back is not held by THEIR answer ====
-- a004 sends it back: their press is their answer, but a005 has still not spoken.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select throws_ok(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  '55089', null,
  'an optional reviewer''s send-back waits for the OTHER optional reviewer');
select throws_like(
  $$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  '%Lead A2%',
  '… naming only them, not the caller');

-- a005 answers.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a005'), true);
select lives_ok($$select public.sub_task_respond('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  'the second optional reviewer answers');

-- ============================== 5-7. now a004's send-back goes through, unheld by their own row ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a004'), true);
select is((select responded_at from sub_task_reviewers
            where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000117a1'
              and user_id = '00000000-0000-0000-0000-00000000a004'), null,
  'a004 has NOT answered on their own row');
select lives_ok($$select app.sub_task_request_changes('aaaaaaaa-0000-0000-0000-0000000117a1')$$,
  '… yet their send-back goes through: the press is the answer, and every other reviewer has spoken');

reset role;
select is((select status::text from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000117a1'),
  'todo', 'the task is back with the maker');
select is((select count(*)::int from sub_task_reviewers
            where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000117a1' and responded_at is not null), 0,
  'and every answer is cleared for the next round, as before (d.8)');

select * from finish();
rollback;
