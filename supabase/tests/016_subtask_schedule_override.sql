-- ADR-0024 (I1.3): the sub-task schedule-override trigger. A hand-edit to a materialised
-- (sub_task-linked) booking flips sub_tasks.schedule_overridden. The materialiser never UPDATEs
-- (it regenerates by delete+insert), so the AFTER-UPDATE trigger only ever sees human edits;
-- non-scheduling edits (notes) don't trip it. Trigger fires for any writer, exercised directly.
begin;
select plan(3);
\ir helpers/seed.sql

insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, sla_hours, status)
values ('aaaaaaaa-0000-0000-0000-00000000b101', 'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000f101', 'Edit hero video',
        '00000000-0000-0000-0000-00000000a003', 12, 'todo');
insert into bookings (id, tenant_id, resource_id, sub_task_id, state, starts_at, ends_at, load_pct)
values ('aaaaaaaa-0000-0000-0000-00000000b201', 'aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d001', 'aaaaaaaa-0000-0000-0000-00000000b101',
        'confirmed', '2026-08-17T06:00:00Z', '2026-08-17T10:00:00Z', 50);

select is((select schedule_overridden from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b101'),
  false, 'sub-task starts not overridden');

-- A hand reschedule of the linked booking flips the flag.
update bookings set starts_at='2026-08-18T06:00:00Z', ends_at='2026-08-18T10:00:00Z'
  where id='aaaaaaaa-0000-0000-0000-00000000b201';
select is((select schedule_overridden from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b101'),
  true, 'hand-editing the linked booking marks the sub-task overridden');

-- Reset; a non-scheduling edit (notes) doesn't trip it.
update sub_tasks set schedule_overridden = false where id='aaaaaaaa-0000-0000-0000-00000000b101';
update bookings set notes = 'context note' where id='aaaaaaaa-0000-0000-0000-00000000b201';
select is((select schedule_overridden from sub_tasks where id='aaaaaaaa-0000-0000-0000-00000000b101'),
  false, 'a non-scheduling booking edit does not mark override');

select * from finish();
rollback;
