-- I29 (ADR-0061) — the database half: bookable, the reschedule notification, and an ad-hoc
-- deliverable following its task.
--
-- All three come out of one investigation: five duplicate ad-hoc tasks, none of which anybody was
-- told about. The theme is that the system knew something the person needed to hear and did not
-- say it.
--
-- **Assertion 4 is the one that keeps this safe.** The bookable guard must apply to a CHANGE of
-- assignee only. Somebody already holding work whose resource is later switched off must still be
-- able to finish it — a rule that stranded live work the moment an admin flipped a switch would be
-- worse than the silence it replaces.
--
-- Subjects (helpers/seed.sql, tenant A): a001 power_admin, a002 scheduler, a003 team_member.

begin;
select plan(15);
\ir helpers/seed.sql

reset role;

-- a003 is bookable through the resource `helpers/seed.sql` links to them (ADR-0011).
--
-- a002 is given the ADNAN TAWFIQ shape instead: their linked resource is replaced by one with
-- `user_id` null. It sits on the grid under its own name, no user-level switch can reach it, and it
-- must not make a002 assignable.
delete from resources where user_id = '00000000-0000-0000-0000-00000000a002';
insert into resources (id, tenant_id, name, kind, user_id, is_active, capacity_model, load_ceiling_pct, warn_at_pct) values
  ('aaaaaaaa-0000-0000-0000-0000000750a2','aaaaaaaa-0000-0000-0000-000000000001',
   'Unlinked Person','human', null, true, 'load_based', 120.0, 100.0);

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000075f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S75');
-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000075e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000075f1','KV 75','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000075a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000075e1','Design 75','todo', 8);
-- 20 Sep: the department has accepted this work (ADR-0072 d.6) — see helpers/seed.sql.
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');

-- ============================================ 1-3. who can be given work ====
select ok(app.person_is_bookable('00000000-0000-0000-0000-00000000a003'),
  'somebody with an active human resource linked to their login is bookable');

-- The Adnan Tawfiq case, asserted directly: an unlinked resource belongs to nobody, so it can
-- never make a person assignable however active it is.
select ok(not app.person_is_bookable('00000000-0000-0000-0000-00000000a002'),
  'an UNLINKED resource does not make its namesake bookable — it belongs to nobody');

reset role;
update resources set is_active = false where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';
select ok(not app.person_is_bookable('00000000-0000-0000-0000-00000000a003'),
  'switching the resource off makes the person unbookable');
update resources set is_active = true where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';

-- ================================ 4-6. the guard, and what it must not break ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000075a1', 'Design 75',
      '00000000-0000-0000-0000-00000000a003',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  'a bookable person can be given work');

select throws_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000075a1', 'Design 75',
      '00000000-0000-0000-0000-00000000a002',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  '22023', null,
  'somebody with no linked bookable resource cannot be given work');

-- **THE safety assertion.** a003 holds the task; now their resource is switched off. Editing that
-- task must keep working, or an admin flipping a switch strands live work.
reset role;
update resources set is_active = false where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$select public.update_task_assignment(
      'aaaaaaaa-0000-0000-0000-0000000075a1', 'Design 75 renamed',
      '00000000-0000-0000-0000-00000000a003',
      '[{"user_id": "00000000-0000-0000-0000-00000000a001", "is_mandatory": true}]'::jsonb)$$,
  'a task ALREADY held by somebody since made unbookable can still be edited and finished');

reset role;
update resources set is_active = true where id = 'aaaaaaaa-0000-0000-0000-00000000d0a3';

-- ==================================== 7-9. moving work tells the person ====
-- The assignee gets a booking, and then somebody else moves it to another day.
reset role;
insert into bookings (id, tenant_id, resource_id, sub_task_id, starts_at, ends_at, state, booked_by)
values ('aaaaaaaa-0000-0000-0000-0000000075b1','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000d0a3','aaaaaaaa-0000-0000-0000-0000000075a1',
        '2026-09-01 05:00:00+00','2026-09-01 13:00:00+00','confirmed',
        '00000000-0000-0000-0000-00000000a001');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
reset role;
update bookings set starts_at = '2026-09-03 05:00:00+00', ends_at = '2026-09-03 13:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-0000000075b1';

select is(
  (select count(*)::int from notifications
    where type = 'rescheduled' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000075a1'),
  1, 'moving somebody''s work to another day tells them');

-- A load or state change on the SAME day is not a move. Telling somebody their Tuesday is still
-- their Tuesday is noise, and noise is what trains people to ignore the channel.
update bookings set load_pct = 50 where id = 'aaaaaaaa-0000-0000-0000-0000000075b1';
select is(
  (select count(*)::int from notifications
    where type = 'rescheduled' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000075a1'),
  1, 'changing the load on the same day does NOT notify — only a change of day is a move');

-- Nobody is notified of their own drag.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
reset role;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
set local role authenticated;
update bookings set starts_at = '2026-09-04 05:00:00+00', ends_at = '2026-09-04 13:00:00+00'
 where id = 'aaaaaaaa-0000-0000-0000-0000000075b1';
select is(
  (select count(*)::int from notifications
    where type = 'rescheduled' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000075a1'),
  1, 'the assignee moving their OWN work is not notified about it');

-- ============ 10-12. an ad-hoc deliverable follows its task, a campaign one does not ====
reset role;
-- Back to the admin's claims: `auth.uid()` follows the JWT, not the database role, so the fixture
-- inserts below would otherwise be judged as a003 — a team member, who holds no bookings:create and
-- may not assign work (I13.4).
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
-- Ad-hoc: no stream, one task. The Al Waha shape.
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000075e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Ad-hoc 75','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000075a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000075e2','Ad-hoc 75','todo','00000000-0000-0000-0000-00000000a003', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000075a2','00000000-0000-0000-0000-00000000a001');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000075a2')$$,
  'the ad-hoc task is cancelled');
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000075e2'),
  'archived',
  'and its deliverable is archived — an abandoned attempt stops sitting in the live list');

-- A CAMPAIGN deliverable holds many tasks, and one being cancelled says nothing about the rest.
select public.sub_task_cancel('aaaaaaaa-0000-0000-0000-0000000075a1');
select is(
  (select state::text from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000075e1'),
  'in_progress',
  'a campaign deliverable is NOT settled by one of its tasks being cancelled');

-- ================== 13-15. a deactivated person cannot be APPOINTED a reviewer ====
-- The picker already hid them: `public.users_holding_permission` filters `up.is_active`. Nothing
-- REFUSED them — the write guard asks `app.user_holds_permission`, which reads role grants and
-- overlays and has never looked at whether the account is live. Hidden, not enforced.
reset role;
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000075e3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Reviewer 75','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000075a3','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000075e3','Reviewer 75','todo', 8);

-- a001 holds reviews:moderate, so ONLY the active flag is in question here.
select lives_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000075a3',
            '00000000-0000-0000-0000-00000000a001')$$,
  'an active moderator can be appointed');

delete from sub_task_reviewers where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000075a3';
update user_profiles set is_active = false where id = '00000000-0000-0000-0000-00000000a001';

select throws_ok(
  $$insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000075a3',
            '00000000-0000-0000-0000-00000000a001')$$,
  '22023', null,
  'a DEACTIVATED person cannot be appointed a reviewer — hidden was not the same as refused');

-- **The other half, and the reason this is INSERT-only.** Somebody deactivated AFTER they were
-- appointed keeps the appointment: deleting it would silently drop a reviewer from work in
-- progress, and re-checking on UPDATE would make clearing approvals impossible — the exact trap
-- ADR-0043's own eligibility check documents. The appointment stands and the SCREEN says so (d.11).
update user_profiles set is_active = true where id = '00000000-0000-0000-0000-00000000a001';
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000075a3',
        '00000000-0000-0000-0000-00000000a001');
update user_profiles set is_active = false where id = '00000000-0000-0000-0000-00000000a001';

select is(
  (select count(*)::int from sub_task_reviewers
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000075a3'),
  1,
  'an appointment made BEFORE the person was deactivated survives — it is surfaced, never deleted');

select * from finish();
rollback;
