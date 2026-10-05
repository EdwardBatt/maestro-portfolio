-- I59.31 / ADR-0112 d.2 — the maker's pin rules, finished:
--   * a pin on a FILE (media_record_id, no sub_task_id) is answered by the assignee of the task that
--     uploaded that file — reply, mark done — exactly as a manual-review note is (Track 7's finding);
--   * the maker can undo their OWN done; nobody else's (a later assignee cannot undo the first maker's,
--     and a maker no longer on the task reaches nothing); the reviewer still re-opens any;
--   * a pin on a deliverable-level file (no task) has no maker; other tenants reach nothing.
--
-- a001 Admin A — the reviewer (reviews:moderate) · a003 Creative A — the maker · a191 Other 179 and
-- a192 Next maker 179 — team members.
begin;
select plan(15);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a191', 'other179@a.test'),
                                          ('00000000-0000-0000-0000-00000000a192', 'next179@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member')
  from (values ('00000000-0000-0000-0000-00000000a191', 'Other 179'), ('00000000-0000-0000-0000-00000000a192', 'Next maker 179')) as v(id, name);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a191', '00000000-0000-0000-0000-00000000a192');

insert into deliverables (id, tenant_id, job_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000d1791', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f001', 'Banner 179');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f1791', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1791',
   'Design 179', 'review', 1, '00000000-0000-0000-0000-00000000a003', 8);
-- The version the maker sent (on the task), and one uploaded against the deliverable itself.
insert into media_records (id, tenant_id, deliverable_id, sub_task_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000e1791', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1791',
   'aaaaaaaa-0000-0000-0000-0000000f1791', 'k/179/v1.png', 'image/png'),
  ('aaaaaaaa-0000-0000-0000-0000000e1792', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1791',
   null, 'k/179/loose.png', 'image/png');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into review_feedback (id, tenant_id, media_record_id, author_user_id, body, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-00000000b179', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e1791',
   '00000000-0000-0000-0000-00000000a001', 'The logo is too small', 0.4, 0.2),
  ('aaaaaaaa-0000-0000-0000-00000000b17a', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e1792',
   '00000000-0000-0000-0000-00000000a001', 'Where is this from?', 0.1, 0.1);
select is((select sub_task_id from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b179'), null::uuid,
  'fixture: the pin is on the FILE — it carries no task of its own');
select is(app.review_feedback_task(null, 'aaaaaaaa-0000-0000-0000-0000000e1791'), 'aaaaaaaa-0000-0000-0000-0000000f1791'::uuid,
  'its task is found through the file — the task that sent that version');

-- ---------------------------------------------------------------- reply and done, on a file ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'Enlarged in v2', 'aaaaaaaa-0000-0000-0000-00000000b179')
$$, 'Track 7: the maker replies to a pin on their file');
select lives_ok($$ update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b179' $$,
  'Track 7: and marks it done');
select is((select done_by from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b179'),
  '00000000-0000-0000-0000-00000000a003'::uuid, 'done, by the maker');
select lives_ok($$ update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b179' $$,
  'settled: the maker undoes their own done');
select is((select done_at from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b179'), null::timestamptz,
  'and the pin is open again');
update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b179';

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a191'), true);
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a191', 'me too', 'aaaaaaaa-0000-0000-0000-00000000b179')
$$, '42501', null, 'someone not on the file''s task cannot reply');

-- ---------------------------------------------------------------- only their OWN done ----
reset role;
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a192' where id = 'aaaaaaaa-0000-0000-0000-0000000f1791';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a192'), true);
select throws_ok($$ update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b179' $$,
  '42501', 'only the reviewer, or whoever marked it done, can re-open this feedback',
  'the next maker cannot undo the first maker''s done');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b179';
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select ok((select done_at is not null from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b179'),
  'and the first maker, no longer on the task, reaches nothing');
select lives_ok($$ update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b179' $$,
  'the reviewer still re-opens it');

-- ---------------------------------------------------------------- a file with no task ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a192'), true);
update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b17a';
select is((select done_at from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b17a'), null::timestamptz,
  'a pin on a deliverable-level file has no maker to mark it done');
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a192', 'mine?', 'aaaaaaaa-0000-0000-0000-00000000b17a')
$$, '42501', null, 'nor to reply to it');

-- ---------------------------------------------------------------- other tenants ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001', 'hi', 'aaaaaaaa-0000-0000-0000-00000000b179')
$$, 'P0002', 'that pin does not exist', 'Tenant B cannot reply into Tenant A''s file pin');
select is(app.review_feedback_task(null, 'aaaaaaaa-0000-0000-0000-0000000e1791'), null::uuid,
  'and the task behind a Tenant A file does not resolve for Tenant B');
reset role;

select * from finish();
rollback;
