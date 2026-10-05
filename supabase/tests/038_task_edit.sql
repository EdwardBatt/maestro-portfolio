-- I11.7 (migration 20260820070000): schedule edit modal — sub_tasks.updated_by stamping + the
-- public.update_task_assignment RPC. Proves: updated_by is stamped on any authenticated update; a
-- project_tasks:manage holder can edit a task's title/assignee/reviewer (ad-hoc deliverable name tracks
-- the title); no self-review (reviewer = assignee rejected); a non-manage user is denied.
-- Seed users (tenant A): a001 power_admin + a002 scheduler hold manage from their roles, a003 team_member from the seed fixture; a
-- client_portal user is added here as the non-manage actor.
begin;
select plan(9);
\ir helpers/seed.sql

-- non-manage actor
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000cc', 'cp@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
  select '00000000-0000-0000-0000-0000000000cc', 'aaaaaaaa-0000-0000-0000-000000000001', 'Client P',
    (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'client_portal');
insert into test_claims
  select up.id, json_build_object('sub', up.id, 'app_metadata',
    json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-0000000000cc';

-- an ad-hoc deliverable (job-backed → stream_id null) + its sub-task, assigned to a003. ADR-0038:
-- an assigned task must have a reviewer, inherited from here, so this names a001 (never an assignee
-- in any fixture, so no-self-review cannot trip).
insert into deliverables (id, tenant_id, job_id, name, state, reviewer_id) values
  ('dddd0000-0000-0000-0000-00000000e701', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f001', 'orig', 'in_progress', '00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours, status) values
  ('57570000-0000-0000-0000-00000000e701', 'aaaaaaaa-0000-0000-0000-000000000001', 'dddd0000-0000-0000-0000-00000000e701', '00000000-0000-0000-0000-00000000a003', 'orig', 2, 'todo');

set local role authenticated;

-- ADR-0038: update_task_assignment now requires the chosen reviewer to actually hold
-- reviews:moderate — naming somebody who cannot act was how tasks ended up stuck with a reviewer
-- who could neither approve nor send back. a003 is the reviewer this test names, so grant it here
-- through the ADR-0036 OVERLAY, which also proves the check is overlay-aware (app.user_holds_permission)
-- rather than role-only. The grant must go in as an admin: tg_stamp_granted_by forces
-- granted_by = auth.uid(), which is NOT NULL.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
          'reviews', 'moderate', 'allow');

-- 1: updated_by is stamped to the editor on a plain update
update sub_tasks set title = 'touched' where id = '57570000-0000-0000-0000-00000000e701';
select is( (select updated_by from sub_tasks where id = '57570000-0000-0000-0000-00000000e701'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'updated_by stamped to the editor on update' );

-- 2-5: a manage holder edits title + reassigns + sets reviewer; ad-hoc deliverable name tracks title
-- ADR-0043: the reviewer parameter is now a LIST of appointments, {user_id, is_mandatory}.
select lives_ok(
  $$ select public.update_task_assignment('57570000-0000-0000-0000-00000000e701', 'renamed',
       '00000000-0000-0000-0000-00000000a002'::uuid,
       '[{"user_id": "00000000-0000-0000-0000-00000000a003", "is_mandatory": false}]'::jsonb,
       null, null, 3.0) $$,
  'project_tasks:manage holder edits the task' );
select is( (select title from sub_tasks where id = '57570000-0000-0000-0000-00000000e701'), 'renamed', 'title updated' );
select is( (select assignee_id from sub_tasks where id = '57570000-0000-0000-0000-00000000e701'),
  '00000000-0000-0000-0000-00000000a002'::uuid, 'assignee reassigned' );
-- ADR-0043 d.9: deliverables.reviewer_id stays as the review stack's deliverable-level record, and
-- update_task_assignment keeps it in step with the appointment list (mandatory first, else first named).
select is( (select reviewer_id from deliverables where id = 'dddd0000-0000-0000-0000-00000000e701'),
  '00000000-0000-0000-0000-00000000a003'::uuid, 'designated reviewer set on the deliverable' );
select is( (select count(*)::int from sub_task_reviewers where sub_task_id = '57570000-0000-0000-0000-00000000e701'),
  1, 'the task carries exactly the one appointment that was sent — the old one was replaced' );
select is( (select name from deliverables where id = 'dddd0000-0000-0000-0000-00000000e701'), 'renamed',
  'ad-hoc (stream-less) deliverable name tracks the task title' );

-- 6: no self-review — reviewer may not be the assignee
select throws_ok(
  $$ select public.update_task_assignment('57570000-0000-0000-0000-00000000e701', 'x',
       '00000000-0000-0000-0000-00000000a002'::uuid,
       '[{"user_id": "00000000-0000-0000-0000-00000000a002"}]'::jsonb, null, null, null) $$,
  '22023', null, 'reviewer cannot be the assignee (no self-review)' );

-- 7: a non-manage user is denied
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-0000000000cc'), true);
select throws_ok(
  $$ select public.update_task_assignment('57570000-0000-0000-0000-00000000e701', 'y',
       '00000000-0000-0000-0000-00000000a003'::uuid, null, null, null, null) $$,
  '42501', null, 'a non-manage user cannot edit the task' );

select finish();
rollback;
