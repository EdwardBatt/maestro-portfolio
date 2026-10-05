-- I54.20 — every refusal in the family names WHO CAN, and carries the key that lets the client say
-- it in the reader's own language.
--
-- Edward, 23 Sep: *"Error messages must be explicit, they should state who to contact if they need
-- a task reordered."*
--
-- What is asserted, and why each half matters:
--   * the WORD is "reach", not "scope" — it is one check (`app.in_write_scope`) and it now reads as
--     one thing wherever it refuses;
--   * `hint` is set — without it the client can only show the database's English, so an Arabic
--     reader gets an English refusal. This is the half that is easy to drop and impossible to see;
--   * the sentence names somebody, or says where to go when it cannot. A refusal that stops a
--     person with nowhere to turn is the fault this whole set exists to fix.
--
-- a003 is Creative A, a team member: no `project_tasks:manage`, which is the commonest way to meet
-- these. a001 is the Power Admin, used only to build the fixture.

begin;
select plan(11);
\ir helpers/seed.sql

-- ---- fixture: a deliverable with a named owner, and one task on it ----------------
-- The owner is a001, so "who can" has a real name to return rather than a null.
insert into deliverables (id, tenant_id, job_id, name, state, owner_user_id, reviewer_id) values
  ('dddd0000-0000-0000-0000-000000148001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001', 'Refusals fixture', 'in_progress',
   '00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a001');

insert into sub_tasks (id, tenant_id, deliverable_id, title, sla_hours, status, sort_order) values
  ('57570000-0000-0000-0000-000000148001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'dddd0000-0000-0000-0000-000000148001', 'A task', 2, 'todo', 1);

-- ---- the name lookup itself ------------------------------------------------------
select is(
  app.refusal_names_deliverable_owner('dddd0000-0000-0000-0000-000000148001'),
  'Admin A', 'the owner lookup returns the person''s name, which is what a refusal quotes');

select is(
  app.refusal_ask('Admin A'), ' Ask Admin A.',
  'the tail of the sentence names them');

-- The case that matters most: nobody to name must still send the person somewhere.
select is(
  app.refusal_ask(null), ' Ask your department lead or Traffic.',
  'and with nobody to name it still says where to go, rather than trailing off');

select is(
  app.refusal_ask('   '), ' Ask your department lead or Traffic.',
  'blank is the same as nobody — an empty name must never reach a screen');

-- ---- a team member is refused, and told who can ----------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select throws_ok(
  $$select public.remove_sub_task('57570000-0000-0000-0000-000000148001')$$,
  '42501',
  'You cannot remove this task: it is outside your reach. Ask Admin A.',
  'removing: refused, in the shared words, naming the deliverable''s owner');

select throws_ok(
  $$select public.sub_task_cancel('57570000-0000-0000-0000-000000148001')$$,
  '42501',
  'You cannot cancel this task: it is outside your reach. Ask Admin A.',
  'cancelling: the same');

select throws_ok(
  $$select public.resequence_deliverable_tasks('dddd0000-0000-0000-0000-000000148001',
      array['57570000-0000-0000-0000-000000148001'::uuid])$$,
  '42501',
  'You cannot reorder this list: it is outside your reach. Ask Admin A.',
  'reordering: the same (I54.18 brought into the family by 20260923120000)');

-- ---- the word, and the key -------------------------------------------------------
-- "scope" was the odd one out across nine refusals for a month, and nothing failed. This is what
-- would have failed.
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and p.prosrc like '%outside your scope%'),
  0, 'no function anywhere still says "outside your scope"');

-- Every one of the nine must set a hint. Without it the client cannot translate, and the only
-- symptom is an English sentence in an Arabic interface — which no test would otherwise catch.
select is(
  (select count(*)::int from unnest(array[
      'resequence_deliverable_tasks', 'remove_sub_task', 'sub_task_cancel', 'sub_task_reinstate',
      'create_adhoc_deliverable', 'approve_department_brief', 'reopen_department_brief',
      'promote_single_job', 'attach_job_to_campaign']) as fn
    where not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and p.prosrc like '%hint = %')),
  0, 'all nine refusals carry a hint, so all nine can be said in Arabic');

select is(
  (select count(*)::int from unnest(array[
      'resequence_deliverable_tasks', 'remove_sub_task', 'sub_task_cancel', 'sub_task_reinstate',
      'create_adhoc_deliverable', 'approve_department_brief', 'reopen_department_brief',
      'promote_single_job', 'attach_job_to_campaign']) as fn
    where not exists (
      select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = fn
         and p.prosrc like '%app.refusal_ask(%')),
  0, 'and all nine name somebody to ask');

-- ---- and a refusal is still a refusal --------------------------------------------
select is(
  (select status from sub_tasks where id = '57570000-0000-0000-0000-000000148001'),
  'todo', 'nothing was removed, cancelled or reordered by any of it');

select finish();
rollback;
