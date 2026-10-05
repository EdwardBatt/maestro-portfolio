-- ADR-0042 d.1: a person required BY a task is told, and is not mistaken for its assignee.
--
-- The gap this closes: tg_booking_notify_resource skipped every booking carrying a sub_task_id,
-- because the sub-task's own trigger notifies the person the work was assigned to. Once a task could
-- require a SECOND person, that skip caught them too — their calendar filled with work nobody had
-- told them about.
--
-- The two assertions that matter are 2 and 3: the required person IS told, and the assignee is NOT
-- told twice. Everything else guards the edges of that.
--
-- Subjects: d001 'Sarah' mapped to a003 (the assignee) and a purpose-built second human resource
-- mapped to a002 (the required person). a001 does the booking, so the actor is neither.

begin;
select plan(6);
\ir helpers/seed.sql

update resources set user_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-00000000d001';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id)
values ('aaaaaaaa-0000-0000-0000-0000000055c1','aaaaaaaa-0000-0000-0000-000000000001',
        'human','Helper 55','load_based',120.0,100.0,'00000000-0000-0000-0000-00000000a002');

insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000055e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Shoot55','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000055a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000055e1','00000000-0000-0000-0000-00000000a003','Day one','todo', 8);

delete from notifications;

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ------------------------------------- the REQUIRED person is told ----
insert into bookings (id, tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
values ('aaaaaaaa-0000-0000-0000-0000000055b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000055c1','aaaaaaaa-0000-0000-0000-0000000055a1',
        'aaaaaaaa-0000-0000-0000-0000000055e1',
        '2026-09-07T06:00:00Z','2026-09-07T10:00:00Z','confirmed', 50);

reset role;
select is(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-00000000a002' and type = 'resource_required'), 1,
  'the person a task REQUIRES is told their time has been taken');

-- Not "assigned": they are additional resource on someone else's task, and a notification saying
-- otherwise would have them believe they own the work.
select is(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-00000000a002' and type = 'assigned'), 0,
  'and is NOT told they were assigned it — the task has one owner');

-- I30.7 (8 Sep): this asserted 'Shoot55', the DELIVERABLE's name, and so held the defect in place —
-- an email that read "has assigned you to 'Creative'" named the container rather than the work.
-- The label is now the task; the campaign arrives separately in context_label (see 093).
select is((select label from notifications
           where user_id = '00000000-0000-0000-0000-00000000a002' limit 1), 'Day one',
  'the label names the TASK they are needed on, not the deliverable containing it');

-- ------------------------------------- the ASSIGNEE is not told twice ----
set local role authenticated;
insert into bookings (id, tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
values ('aaaaaaaa-0000-0000-0000-0000000055b2','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-0000000055a1',
        'aaaaaaaa-0000-0000-0000-0000000055e1',
        '2026-09-07T06:00:00Z','2026-09-07T14:00:00Z','confirmed', 100);
reset role;
select is(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-00000000a003' and type = 'resource_required'), 0,
  'the task''s own assignee gets no required-resource notice — their sub-task trigger carries it');

-- ------------------------------------- equipment has nobody to tell ----
set local role authenticated;
insert into bookings (id, tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state)
values ('aaaaaaaa-0000-0000-0000-0000000055b3','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d002','aaaaaaaa-0000-0000-0000-0000000055a1',
        'aaaaaaaa-0000-0000-0000-0000000055e1',
        '2026-09-08T06:00:00Z','2026-09-08T10:00:00Z','confirmed');
reset role;
select is((select count(*)::int from notifications where type = 'resource_required'), 1,
  'booking a camera notifies nobody — equipment has no user behind it');

-- ------------------------------------- nobody is told about their own action ----
-- a002 books THEMSELVES onto the task. The refusal-to-notify here is the same actor-exclusion rule
-- the rest of the notification layer uses.
delete from notifications;
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
insert into bookings (id, tenant_id, resource_id, sub_task_id, deliverable_id, starts_at, ends_at, state, load_pct)
values ('aaaaaaaa-0000-0000-0000-0000000055b4','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-0000000055c1','aaaaaaaa-0000-0000-0000-0000000055a1',
        'aaaaaaaa-0000-0000-0000-0000000055e1',
        '2026-09-09T06:00:00Z','2026-09-09T10:00:00Z','confirmed', 50);
reset role;
select is((select count(*)::int from notifications where type = 'resource_required'), 0,
  'requiring yourself notifies nobody');

select * from finish();
rollback;
