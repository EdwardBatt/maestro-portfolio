-- ADR-0048 d.8/d.9/d.10 (I16.5): nothing on an unapproved campaign may be assigned or booked,
-- and only the account manager can approve.
--
-- The assertion that matters is 3: the gate is held by POSTGRES, not by an RPC. ADR-0043 put
-- "every mandatory reviewer must approve" inside a function and a plain PostgREST update went
-- round it. Every block below is driven by a bare UPDATE/INSERT, the way PostgREST would, and
-- not through any RPC — because that is the hole being closed.
--
-- Subjects: a001 is the account manager on the pending campaign; a003 is a team member with
-- neither projects:manage nor the scope to reach it (ADR-0073 d.1: the grant is necessary and
-- never sufficient, and here neither is present).

begin;
select plan(14);
\ir helpers/seed.sql

reset role;

-- A pending campaign with a stream, a deliverable and an unassigned task.
insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000059e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Pending Campaign','pending_approval',
   '00000000-0000-0000-0000-00000000a001');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000059a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000059e1','Creative');
insert into deliverables (id, tenant_id, stream_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000059d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000059a1','Hero film');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000059a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000059d1','Shoot','todo', 8);
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-0000000059e1');

select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000059e1'),
  'pending_approval', 'a campaign starts pending — nothing is live until somebody agrees');

-- ------------------------------------- the gate, driven as PostgREST would ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000059a2'
$$, '42501', null,
  'work on a pending campaign cannot be assigned — by a BARE UPDATE, not via an RPC');

select throws_ok($$
  insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-0000000059b1','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000059a2',
          '2027-04-01T06:00:00Z','2027-04-01T10:00:00Z','confirmed',50)
$$, '42501', null,
  'and cannot be booked either — a booking is the other way a plan becomes somebody''s day');

-- Reviewing is still possible: the point is to read the plan, so editing it must work.
select lives_ok($$
  update sub_tasks set title = 'Shoot, retitled'
   where id = 'aaaaaaaa-0000-0000-0000-0000000059a2'
$$, 'but the task can still be edited — that is what reviewing it means');

-- ------------------------------------- who may approve ----
-- SUBJECT CHANGED 5 Sep (ADR-0073 d.4). This used to be a002, the Scheduler, on the reasoning that
-- "not the account manager" was the whole test. That reasoning no longer holds: approval is now
-- decided by `projects:manage` AND `app.in_write_scope`, and the Scheduler is tenant-scoped, so it
-- passes — as the Traffic Manager failsafe ADR-0070 established and ADR-0073 extends to this gate.
-- The assertion is still worth making, so it moves to a subject who genuinely cannot: a003 is a
-- team member, `self`-scoped, and holds project_tasks:manage but not projects:manage.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$
  select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000059e1')
$$, '42501', null, 'somebody with neither the grant nor the scope cannot approve it');

reset role;
select is(
  (select status from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000059e1'),
  'pending_approval', 'and the campaign is untouched by the attempt');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$
  select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000059e1')
$$, 'the account manager approves it');

select throws_ok($$
  select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000059e1')
$$, '22023', null, 'approving twice is refused, not silently repeated');

-- ------------------------------------- approval releases the work ----
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000059a2'
$$, 'once approved, the work can be assigned');

reset role;
select is(
  (select approved_by from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000059e1'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'and the record names who approved it');

-- ------------------------------------- ad-hoc work is NOT governed by this ----
-- Ad-hoc work (ADR-0035) hangs off a JOB, not a stream, so it resolves to no campaign and
-- `campaign_is_approved(null)` is true by design. Gating it would break a live feature this
-- ADR never touched — ad-hoc scheduling is what the agency is doing today.
--
-- The subject is a real sub-task on `f101`, the fixture's job-backed deliverable. An earlier
-- version of this test pointed at a USER id by mistake, so the UPDATE matched nothing and
-- `lives_ok` passed while proving nothing at all. Assertion 12 exists to make that impossible:
-- if the row is not actually there, the count is 0 and the test fails.
reset role;
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000059f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f101','Ad-hoc retouch','todo', 8);

select is(app.sub_task_campaign('aaaaaaaa-0000-0000-0000-0000000059f1'), null,
  'an ad-hoc sub-task resolves to NO campaign — it hangs off a job, not a stream');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$
  update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000059f1'
$$, 'so ad-hoc work can still be assigned — today''s scheduling is untouched');

select lives_ok($$
  insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, load_pct)
  values ('aaaaaaaa-0000-0000-0000-0000000059b2','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000059f1',
          '2027-05-03T06:00:00Z','2027-05-03T10:00:00Z','confirmed',50)
$$, 'and still be booked — the booking gate does not touch work with no campaign');

reset role;
select is(
  (select count(*)::int from sub_tasks
    where id = 'aaaaaaaa-0000-0000-0000-0000000059f1'
      and assignee_id = '00000000-0000-0000-0000-00000000a003'), 1,
  'and the assignment actually landed — not a vacuous pass on a row that was never there');

select * from finish();
rollback;
