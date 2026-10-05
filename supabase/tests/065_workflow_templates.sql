-- I19 (ADR-0052) — a deliverable type implies a list of unassigned tasks.
--
-- Assertions 4 and 5 are why this suite exists: **the deadlock**. ADR-0052 d.5 lays a whole task
-- list down unassigned, and the transition guard refused `in_review` while ANY sub-task was `todo`
-- — while an unassigned task can never be submitted, because `app.sub_task_submit` raises "only the
-- assignee may submit this task". A LONG FORM deliverable seeded with sixteen tasks could never
-- have reached review or sign-off at all.
--
-- Assertion 6 is the other half, and it is the one a naive fix fails. `and st.assignee_id is not
-- null` alone would let an `in_progress` task with logged hours be unassigned by a plain PATCH and
-- vanish from both gates — a deliverable signed off with started work outstanding.

begin;
select plan(20);
\ir helpers/seed.sql

reset role;

-- Migrations seed the tenants that exist when they run; this fixture creates its own afterwards.
select app.seed_tenant_deliverable_taxonomy(id) from tenants;
select app.seed_tenant_workflow_templates(id) from tenants;

-- A tenant-B template with a KNOWN id. Selecting one by code inside the cross-tenant assertion
-- below would run under RLS as a tenant-A user, resolve to NULL, and silently test nothing.
insert into workflow_templates (id, tenant_id, code, name_en, is_system)
values ('aaaaaaaa-0000-0000-0000-0000000065b1','bbbbbbbb-0000-0000-0000-000000000001',
        'WF-B-ONLY','Tenant B only', false);

-- =========================================================== 1-3. the seed ====
select is((select count(*)::int from workflow_templates
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 14,
  'fourteen templates seeded');

select is((select count(*)::int from workflow_steps
            where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 154,
  'one hundred and fifty-four steps across them');

-- WF-03 and WF-11 are the pair ADR-0052 d.3 refuses to merge. Neither contains the other, which is
-- the evidence for keeping both: Long Form adds Physical Media, Ingest, Backup and Archive; WF-03
-- has Concept, Script, Storyboard, Sound and Grade that Long Form lacks.
select is(
  (select string_agg(n::text, ',' order by n) from (
     select count(*) as n from workflow_steps ws
       join workflow_templates wt on wt.id = ws.template_id
      where wt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and wt.code in ('WF-03','WF-11')
      group by wt.code order by wt.code) x),
  '14,16', 'WF-03 and WF-11 are different lengths — they are not duplicates of one another');

-- ============================================ 4-5. THE DEADLOCK, asserted gone ====
-- A deliverable typed to WF-01 (8 steps). Its whole task list is laid down by the trigger,
-- unassigned, and it must still be able to reach review and sign-off.
update deliverable_types set default_workflow_template_id =
  (select id from workflow_templates
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'WF-01')
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'DIG-003';

-- The fixture department (ADR-0099 d.2, 23 Sep): a deliverable's department is its own and is no
-- longer derived from the owner, so a fixture that names an owner with no department must say
-- which department the work belongs to. Created here rather than assumed.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de0ff', 'aaaaaaaa-0000-0000-0000-000000000001', 'Fixture dept')
on conflict (id) do nothing;

insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, deliverable_type_id)
select 'aaaaaaaa-0000-0000-0000-0000000065e1','aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-00000000f001','Landing page','in_progress',
       '00000000-0000-0000-0000-00000000a003', dt.id
from deliverable_types dt
where dt.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and dt.code = 'DIG-003';

select is((select count(*)::int from sub_tasks
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'), 8,
  'setting a type on insert lays out its eight tasks — the trigger, not an RPC');

select is((select count(*)::int from sub_tasks
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'
              and assignee_id is null and status = 'todo'), 8,
  'all of them unassigned: the template proposes WORK, never who does it');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$update deliverables set state = 'in_review'
     where id = 'aaaaaaaa-0000-0000-0000-0000000065e1'$$,
  'eight unassigned tasks do NOT hold the in_review gate — the deadlock, gone');

-- ADR-0118 (27 Sep) reverses d.10 for SIGN-OFF: once a list is approved its tasks are real work, and a
-- deliverable is approved only when every task is done or cancelled — unassigned ones included.
select throws_ok(
  $$update deliverables set state = 'approved'
     where id = 'aaaaaaaa-0000-0000-0000-0000000065e1'$$,
  '55000', 'deliverable: every sub-task must be APPROVED before sign-off (ADR-0038)',
  'but they DO hold the sign-off gate (ADR-0118)');

select is(
  (select state::text from deliverables
    where id = 'aaaaaaaa-0000-0000-0000-0000000065e1'), 'in_review',
  'and the deliverable is not approved with eight tasks never given out');

-- ================== 6. the naive fix would have failed THIS one ====
-- A task that was assigned, worked on, and then unassigned by a plain PATCH. It is NOT a plan, and
-- it must still hold both gates. `and st.assignee_id is not null` alone would have let it through.
reset role;
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000065e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Worked then orphaned','in_progress', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-0000000de0ff');

insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000065a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000065e2','Real work','00000000-0000-0000-0000-00000000a003','todo', 8);

insert into task_time_entries (tenant_id, sub_task_id, user_id, round, minutes, mode, submitted_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000065a1',
        '00000000-0000-0000-0000-00000000a003', 0, 90, 'manual', now());

update sub_tasks set assignee_id = null where id = 'aaaaaaaa-0000-0000-0000-0000000065a1';

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok(
  $$update deliverables set state = 'in_review'
     where id = 'aaaaaaaa-0000-0000-0000-0000000065e2'$$,
  '55000', null,
  'an unassigned task with logged time is NOT a plan — it still holds the gate');

-- ============================================= 7-8. idempotent re-run (d.6) ====
select is(
  (select public.apply_workflow_template('aaaaaaaa-0000-0000-0000-0000000065e1')), 0,
  're-running the same template creates nothing — every step already has its task');

reset role;
delete from sub_tasks
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'
   and sort_order = 8;
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is(
  (select public.apply_workflow_template('aaaaaaaa-0000-0000-0000-0000000065e1')), 1,
  'and re-running after one goes missing creates exactly that one back');

-- ================================================= 9. cross-tenant ====
select throws_ok(
  $$select public.apply_workflow_template('aaaaaaaa-0000-0000-0000-0000000065e1',
      'aaaaaaaa-0000-0000-0000-0000000065b1')$$,
  '22023', null,
  'another tenant''s template is refused, not silently ignored');

-- ================================ 10. nothing seeded names an organisation ====
-- The binding constraint, asserted rather than asserted-in-prose. A template names WORK; the
-- department on a materialised task comes from the DELIVERABLE (ADR-0050), never the step.
reset role;
select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'
      and department_id is distinct from
          (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000065e1')),
  0, 'every materialised task takes the DELIVERABLE''s department, never one from the template');

-- ============================ 11-14. editing the list (d.12, d.13, d.14) ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- A task that was only ever a PLAN is deleted outright: it was never anybody's work, so there is
-- no record worth keeping and a cancelled row would be clutter in a list still being reviewed.
select is(
  (select public.remove_sub_task(
     (select id from sub_tasks
       where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1' and sort_order = 1))),
  'deleted', 'a task nobody was ever given is removed outright');

-- The worked-then-orphaned task from assertion 9 is NOT a plan, whatever its assignee column says. ADR-0140 d.3
-- (3 Oct): work somebody STARTED is not removed at all — it is called off only by the piece's own close.
select throws_ok($$ select public.remove_sub_task('aaaaaaaa-0000-0000-0000-0000000065a1') $$,
  '22023', null, 'work somebody STARTED is not removed (ADR-0140 d.3)');

select isnt(
  (select status from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000065a1'),
  'cancelled', 'and its record is untouched');

-- d.14: reordering is presentation. The dates must not move — this is the same class of surprise
-- as a booking silently relocating itself (I17).
reset role;
update sub_tasks set starts_at = '2026-09-01T00:00:00Z', due_at = '2026-09-05T00:00:00Z'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$select public.resequence_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000065e1',
      (select array_agg(id order by sort_order desc) from sub_tasks
        where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'))$$,
  'the list can be reordered');

select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'
      and (starts_at is distinct from '2026-09-01T00:00:00Z'::timestamptz
           or due_at is distinct from '2026-09-05T00:00:00Z'::timestamptz)),
  0, 'and NOT ONE date moved — order is presentation, a schedule is a commitment');

-- ================= 19-20. a refused reorder says who CAN (I54.18, 23 Sep) ====
-- The surface shows this sentence VERBATIM since I53.28 (22 Sep), so it is copy, not a developer's
-- note, and it is asserted like copy. a003 is a team member: it holds no `project_tasks:manage`,
-- which is the first half of the gate and the commonest way to meet this refusal.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- The tail names a PERSON since `20260923120000` (I54.20), and which person depends on this
-- suite's own fixture — so the assertion pins the shape: refused, in the shared words, with
-- somebody to ask. Suite 148 pins the exact sentence against a fixture built for it.
select throws_like(
  $$select public.resequence_deliverable_tasks('aaaaaaaa-0000-0000-0000-0000000065e1',
      (select array_agg(id order by sort_order) from sub_tasks
        where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'))$$,
  'You cannot reorder this list: it is outside your reach. Ask %',
  'a team member is refused, and the refusal NAMES who can — it used to name nobody');

-- And the refusal is still a refusal: nothing moved.
select is(
  (select count(*)::int from sub_tasks
    where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000065e1'
      and (starts_at is distinct from '2026-09-01T00:00:00Z'::timestamptz
           or due_at is distinct from '2026-09-05T00:00:00Z'::timestamptz)),
  0, 'and a refused reorder moved nothing at all');

select finish();
rollback;
