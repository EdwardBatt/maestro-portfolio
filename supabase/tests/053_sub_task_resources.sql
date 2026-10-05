-- ADR-0042 (I13.1): the assets a task needs are held on the task.
--
-- A booking is a booking OF a resource; sub_task_resources is the other direction — the resources a
-- task NEEDS. Before this the requirement existed only as a side effect of a calendar entry, and
-- `subtask-schedule` deleted it on every reassignment, date change or hours change.
--
-- What these assertions are actually protecting:
--   * writes carry the TASK's authority, and specifically NOT the assignee self-branch that
--     sub_tasks has — deciding a task needs the RED camera is management, not progress;
--   * the composite (tenant_id, resource_id) FK, which is the only thing stopping a requirement
--     pointing at another tenant's camera. A plain `references resources(id)` would not;
--   * the shape a work-type template has to be able to populate: (task, resource, hours), with
--     starts_on optional.
--
-- The span half of ADR-0042 (d.5 — a required resource can never move the task's dates) lives in
-- `046_task_owns_its_dates.sql`, next to the invariant it narrows.
--
-- Subjects, all from the seed: a001 power_admin (tenant scope), a002 Booker A / scheduler (tenant
-- scope, holds project_tasks:manage), a003 Creative A / team_member (scope 'self' — and the seed
-- gives a003 project_tasks:manage ON PURPOSE, so a refusal proves scope decided it, not the grant).

begin;
select plan(14);
\ir helpers/seed.sql

insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000053e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Shoot53','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000053e1','00000000-0000-0000-0000-00000000a003','Day one','todo', 8);

set local role authenticated;

-- ============================================================ who may state a requirement ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$insert into sub_task_resources (id, tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000005301','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d002', 2)$$,
  'someone who manages the task may say it needs the camera');

select is((select starts_on from sub_task_resources where id = 'aaaaaaaa-0000-0000-0000-000000005301'),
  null,
  'starts_on is optional — null means "the task''s first day", which is what a template writes');

-- a002 is a second, non-power-admin allow: tenant scope + project_tasks:manage.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select lives_ok(
  $$insert into sub_task_resources (id, tenant_id, sub_task_id, resource_id, hours, starts_on)
    values ('aaaaaaaa-0000-0000-0000-000000005302','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d003', 1,
            '2026-09-03')$$,
  'and so may a traffic manager — this is the task''s authority, not an admin-only power');

-- ---------------------------------- the ASSIGNEE is not, by itself, someone who may manage ----
-- a003 IS this task's assignee and DOES hold project_tasks:manage, so if scope were not doing the
-- work here this would succeed. sub_tasks carries an `assignee_id = auth.uid()` branch so a member
-- can progress their own task; that branch is deliberately absent here.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is(app.has_permission('project_tasks', 'manage'), true,
  'the assignee holds project_tasks:manage …');
select is(app.can_manage_sub_task('aaaaaaaa-0000-0000-0000-0000000053a1'), false,
  '… and still may not MANAGE the task: scope ''self'' decides it, not the grant');

select throws_ok(
  $$insert into sub_task_resources (id, tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000005303','aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d001', 1)$$,
  '42501', null,
  'so being the assignee does not let you decide what the task needs');

-- An UPDATE the USING clause filters out is not an error, it is a no-op — assert the row, not a throw.
update sub_task_resources set hours = 99 where id = 'aaaaaaaa-0000-0000-0000-000000005301';
select is((select hours from sub_task_resources where id = 'aaaaaaaa-0000-0000-0000-000000005301'), 2::numeric,
  'nor edit one that is already there');

-- ==================================================================== the shape holds ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok(
  $$insert into sub_task_resources (tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d002', 1)$$,
  '23505', null,
  'the same resource cannot be required twice on one task — two cameras means two resources');

select throws_ok(
  $$insert into sub_task_resources (tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d001', 0)$$,
  '23514', null,
  'a requirement for zero hours is not a requirement');

-- The point of the 26 Aug change: a part-day requirement must be expressible at all. `days` could
-- only ever say "a whole day", so a three-hour camera blocked the studio until home time.
select lives_ok(
  $$insert into sub_task_resources (tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d001', 3.5)$$,
  'a requirement can be part of a day — hours are the booking vocabulary (ADR-0006)');

-- THE TENANT FENCE. `references resources(id)` would happily accept tenant B's camera; the
-- composite (tenant_id, resource_id) FK is what refuses it, for every writer, without RLS having to
-- go looking.
select throws_ok(
  $$insert into sub_task_resources (tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','bbbbbbbb-0000-0000-0000-00000000d001', 1)$$,
  '23503', null,
  'a task cannot require another tenant''s resource');

-- ======================================================================= cross-tenant ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);

select is((select count(*)::int from sub_task_resources), 0,
  'tenant B''s power admin sees none of tenant A''s requirements');

select throws_ok(
  $$insert into sub_task_resources (tenant_id, sub_task_id, resource_id, hours)
    values ('aaaaaaaa-0000-0000-0000-000000000001',
            'aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-00000000d002', 1)$$,
  '42501', null,
  'and cannot write one either, power admin of their own tenant or not');

-- ========================================================================== cascade ====
-- The requirement is a property of the task. When the task goes, it goes — it is not a loose row to
-- be found later attached to nothing.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
delete from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000053a1';
select is((select count(*)::int from sub_task_resources
           where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000053a1'), 0,
  'deleting the task takes its requirements with it');

select * from finish();
rollback;
