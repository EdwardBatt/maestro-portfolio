-- ADR-0039 (I12.2): the task owns its dates.
--
-- The defect: reschedule updated the `bookings` row and nothing else, while overdue, due-today, SLA
-- and every count read the TASK. Drag work to next week and the grid agreed, the deadline silently
-- did not move, and the task went overdue on its original date with nobody at fault.
--
-- The fix is an envelope: a task's span is the earliest start to the latest end of its live
-- bookings, maintained by a trigger so no call site can forget it. That is also what lets a
-- multi-day task's chips move INDEPENDENTLY (Edward's decision) — work Mon/Wed/Fri, due Friday.
--
-- NARROWED BY ADR-0042 d.5 (26 Aug): the envelope is the ASSIGNEE's bookings, not every booking on
-- the task. Once a task can require an asset, "all its bookings" is the wrong set — book the camera
-- on the one day it is free, the Tuesday after the shoot, and the task's deadline silently follows
-- it out. A deadline moves only because a person moved it. The assertions below are unchanged in
-- substance; what changed is that the seed resource is now MAPPED to the assignee, because that
-- mapping is what makes a booking the assignee's, and one new case proves the narrowing bites.
--
-- Subjects: seed resource 'Sarah' (a human, load_based) in tenant A, mapped to Creative A.

begin;
select plan(10);
\ir helpers/seed.sql

-- Sarah IS the assignee's resource. Done here rather than in helpers/seed.sql so no other suite's
-- subject silently changes shape; the transaction rolls back either way.
update resources set user_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-00000000d001';

insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000046e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Span46','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000046a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000046e1','00000000-0000-0000-0000-00000000a003','Spread46','todo',
   '2026-09-01T06:00:00Z','2026-09-01T14:00:00Z', 8);

-- --------------------------------------------------- a task with no bookings is left alone ----
-- Unscheduled is not undated: releasing a schedule must never silently erase a deadline.
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-01T14:00:00Z'::timestamptz,
  'with no bookings the task keeps the dates it was given');

-- ------------------------------------------------------------- the envelope forms ----
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state) values
  ('aaaaaaaa-0000-0000-0000-0000000046b1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000046a1',
   '2026-09-02T06:00:00Z','2026-09-02T10:00:00Z','confirmed'),
  ('aaaaaaaa-0000-0000-0000-0000000046b2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000046a1',
   '2026-09-04T06:00:00Z','2026-09-04T10:00:00Z','confirmed');

select is((select starts_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T06:00:00Z'::timestamptz, 'the task starts when its earliest booking starts');
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-04T10:00:00Z'::timestamptz, 'and is due when its latest booking ends');

-- -------------------------------------------------- dragging ONE chip moves the deadline ----
-- The whole point: a single day moved on the grid moves the work, so overdue/SLA follow it.
update bookings set starts_at = '2026-09-09T06:00:00Z', ends_at = '2026-09-09T10:00:00Z'
 where id = 'aaaaaaaa-0000-0000-0000-0000000046b2';
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-09T10:00:00Z'::timestamptz,
  'moving the LAST chip moves the due date — the grid and the deadline no longer disagree');
select is((select starts_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T06:00:00Z'::timestamptz,
  'and the other chip stays put — a gap is real, chips move independently');

-- ------------------------------------------------------------- removal shrinks it ----
delete from bookings where id = 'aaaaaaaa-0000-0000-0000-0000000046b2';
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T10:00:00Z'::timestamptz, 'removing a booking pulls the due date back');

-- --------------------------------------------- a cancelled booking is not when work happens ----
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state) values
  ('aaaaaaaa-0000-0000-0000-0000000046b3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000046a1',
   '2026-09-20T06:00:00Z','2026-09-20T10:00:00Z','cancelled');
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T10:00:00Z'::timestamptz, 'a cancelled booking does not extend the task''s span');

-- ------------------------------------------------------- the last booking going away ----
delete from bookings where id = 'aaaaaaaa-0000-0000-0000-0000000046b1';
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T10:00:00Z'::timestamptz,
  'with every live booking gone the task KEEPS its last known dates rather than losing them');

-- ================================================================ ADR-0042 d.5 ====
-- A resource required BY the task is booked for its own days and must never move the task's dates.
-- Two shapes, one rule. First the camera: an asset booked a fortnight after the work.
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state) values
  ('aaaaaaaa-0000-0000-0000-0000000046b4','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000d002','aaaaaaaa-0000-0000-0000-0000000046a1',
   '2026-09-16T06:00:00Z','2026-09-16T10:00:00Z','confirmed');
select is((select due_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T10:00:00Z'::timestamptz,
  'a camera booked for the task does not drag the task''s deadline out with it');

-- Then a second PERSON, which is the same rule and the easier one to get wrong: they are a required
-- resource on the task, not a second assignee, so their days do not define the work's span either.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id)
values ('aaaaaaaa-0000-0000-0000-0000000046c1','aaaaaaaa-0000-0000-0000-000000000001',
        'human','Helper 46','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a002');
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state) values
  ('aaaaaaaa-0000-0000-0000-0000000046b5','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000046c1','aaaaaaaa-0000-0000-0000-0000000046a1',
   '2026-08-20T06:00:00Z','2026-08-20T10:00:00Z','confirmed');
select is((select starts_at from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000046a1'),
  '2026-09-02T06:00:00Z'::timestamptz,
  'nor does a second person booked onto the task pull its start date backwards');

select * from finish();
rollback;
