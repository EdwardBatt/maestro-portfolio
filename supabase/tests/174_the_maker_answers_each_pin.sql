-- I59.29 / ADR-0112 d.2 — the maker replies to a pin and marks it done; the reviewer re-opens it; the
-- reviewer's own powers are unchanged; nobody else, and no other tenant, can do any of it.
--
-- a001 Admin A — the reviewer who pins (reviews:moderate) · a003 Creative A — the maker, the task's
-- assignee (a team member: no reviews:moderate) · a191 Other maker 174 — a team member, not on the task.
begin;
select plan(21);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a191', 'other174@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
values ('00000000-0000-0000-0000-00000000a191', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other maker 174',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'));
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a191';

insert into deliverables (id, tenant_id, job_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000d1741', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f001', 'Banner 174');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000f1741', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1741',
   'Design 174', 'review', 1, '00000000-0000-0000-0000-00000000a003', 8);

select ok(not app.user_holds_permission('00000000-0000-0000-0000-00000000a003', 'reviews', 'moderate'),
  'the maker holds no reviews:moderate — what they may do comes from being the assignee');

set local role authenticated;

-- The reviewer pins.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into review_feedback (id, tenant_id, sub_task_id, author_user_id, body, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-00000000b174', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1741',
   '00000000-0000-0000-0000-00000000a001', 'The logo is too small', 0.4, 0.2);

-- ---------------------------------------------------------------- the reply ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok($$
  insert into review_feedback (id, tenant_id, author_user_id, body, parent_id, pos_x) values
    ('aaaaaaaa-0000-0000-0000-00000000c174', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
     'Enlarged to 120px in v2', 'aaaaaaaa-0000-0000-0000-00000000b174', 0.9)
$$, 'the maker replies to a pin on their task');
select results_eq($$
  select sub_task_id, round, pos_x from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000c174'
$$, $$ select sub_task_id, round, null::numeric from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  'the reply takes its pin''s task and round, and no position of its own');
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'and again', 'aaaaaaaa-0000-0000-0000-00000000c174')
$$, '22023', 'a reply answers a pin, not another reply', 'one level: a reply to a reply is refused');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a191'), true);
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a191', 'me too', 'aaaaaaaa-0000-0000-0000-00000000b174')
$$, '42501', null, 'someone not on the task cannot reply');
select lives_ok($$
  insert into review_feedback (tenant_id, sub_task_id, author_user_id, body) values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000f1741', '00000000-0000-0000-0000-00000000a191', 'Looks good')
$$, 'a top-level comment keeps today''s rule — any internal user, as themself');

-- ---------------------------------------------------------------- mark done ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a191'), true);
update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is((select done_at from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174'), null,
  'someone not on the task cannot mark it done (no row reaches them)');

update review_feedback set done_at = '2020-01-01', done_by = '00000000-0000-0000-0000-00000000a001'
 where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
select results_eq($$
  select done_by, done_at > now() - interval '1 minute' from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174'
$$, $$ values ('00000000-0000-0000-0000-00000000a003'::uuid, true) $$,
  'the maker marks the pin done — the database stamps who and when, whatever the client sent');
select throws_ok($$ update review_feedback set body = 'The logo is fine' where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  '42501', null, 'the maker cannot rewrite the reviewer''s pin');
select throws_ok($$ update review_feedback set resolved = true where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  '42501', null, 'nor resolve it — the reviewer keeps the final word');
-- I59 (settled 25 Sep): the maker may undo their OWN done (179 covers someone else's).
select lives_ok($$ update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  'the maker undoes their own done');
select results_eq($$ select done_at, done_by from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  $$ values (null::timestamptz, null::uuid) $$, 'and the pin is open again');
update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
select throws_ok($$ update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000c174' $$,
  '22023', null, 'a reply is not marked done — the pin is');

-- ---------------------------------------------------------------- re-open ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
select results_eq($$ select done_at, done_by from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  $$ values (null::timestamptz, null::uuid) $$, 'the reviewer re-opens the pin — back on the maker''s list');
select throws_ok($$ update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  '42501', 'only the person doing the task can mark its feedback done', 'the reviewer cannot mark it done');
update review_feedback set body = 'The logo is too small — try 140px', resolved = true where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
select results_eq($$ select body, resolved from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  $$ values ('The logo is too small — try 140px'::text, true) $$, 'the reviewer still edits and resolves their pin, as before');

-- ---------------------------------------------------------------- the round gate is untouched ----
reset role;
update sub_tasks set revision_number = revision_number + 1, status = 'todo' where id = 'aaaaaaaa-0000-0000-0000-0000000f1741';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
insert into review_feedback (id, tenant_id, author_user_id, body, parent_id) values
  ('aaaaaaaa-0000-0000-0000-00000000d174', 'aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
   'Done in v2', 'aaaaaaaa-0000-0000-0000-00000000b174');
select ok((select round from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000d174')
          < app.task_review_round('aaaaaaaa-0000-0000-0000-0000000f1741'),
  'a reply made in the next round keeps the pin''s round — it cannot stand in for this round''s note (manual submit gate)');
select lives_ok($$ update review_feedback set done_at = now() where id = 'aaaaaaaa-0000-0000-0000-00000000b174' $$,
  'the maker marks the re-opened pin done again');

-- ---------------------------------------------------------------- other tenants ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from review_feedback where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f1741'), 0,
  'Tenant B sees none of the pins or replies');
select throws_ok($$
  insert into review_feedback (tenant_id, author_user_id, body, parent_id) values
    ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001', 'hi', 'aaaaaaaa-0000-0000-0000-00000000b174')
$$, 'P0002', 'that pin does not exist', 'Tenant B cannot reply into Tenant A — the pin does not exist for them');
update review_feedback set done_at = null where id = 'aaaaaaaa-0000-0000-0000-00000000b174';
reset role;
select ok((select done_at is not null from review_feedback where id = 'aaaaaaaa-0000-0000-0000-00000000b174'),
  'Tenant B cannot re-open Tenant A''s pin');

select * from finish();
rollback;
