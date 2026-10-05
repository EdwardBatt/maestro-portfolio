-- I54.25 — the planner knows what a permission check costs, and the list it was killing is fast.
--
-- **What went wrong.** "Waiting for you" took 9 seconds and was cut off by the 8-second statement
-- timeout, so a lead opened My Work and was told they had nothing to approve. The panel hides
-- itself when the list is empty, and a list that never arrived looks exactly like an empty one.
--
-- Postgres prices a function at 0.0025 units unless told otherwise, so an authorisation check that
-- runs several queries was priced like an integer comparison. The plan therefore applied
-- `sub_task_can_decide_extension(id)` as a filter across **every task in the tenant** —
-- `Rows Removed by Filter: 1444` — before reaching the thirteen extension events it was meant for.
--
-- **This suite guards the fix, not the symptom.** A timing assertion would be flaky on a shared
-- runner and meaningless on an empty fixture database; what is worth holding is that the prices
-- stay on the functions. Lose them and the plan reverts, silently, and the panel goes blank again
-- on production while every test still passes.

begin;
select plan(9);
\ir helpers/seed.sql

-- ---- the expensive ones: they walk the schema, several reads each --------------------
select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'sub_task_can_decide_extension'),
  '>=', 1000::real,
  'sub_task_can_decide_extension is priced as expensive — this is the one that scanned 1,444 tasks');

select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'sub_task_can_request_extension'),
  '>=', 1000::real, 'sub_task_can_request_extension is priced as expensive');

select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'sub_task_extension_approver'),
  '>=', 1000::real, 'sub_task_extension_approver is priced as expensive');

select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'resource_in_scheduling_scope'),
  '>=', 1000::real, 'resource_in_scheduling_scope is priced as expensive');

-- ---- the two the whole system leans on ----------------------------------------------
-- Cheaper per call — a grant lookup, not a walk through half the schema — but still reads, and
-- still priced at nothing by default.
select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'has_permission'),
  '>=', 100::real, 'has_permission is priced above the default');

select cmp_ok(
  (select procost from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'in_write_scope'),
  '>=', 100::real, 'in_write_scope is priced above the default');

-- ---- and the answer did not change ---------------------------------------------------
-- Pricing reorders the work; it must never reorder who sees what. A003 is a team member with no
-- approval rights anywhere, and owes nothing before or after.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select is(
  (select count(*)::int from public.my_pending_approvals()),
  0, 'a team member is still owed nothing — pricing changes the ORDER of the work, never the answer');

-- The Power Admin's list still assembles without error, which is the shape that was timing out.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select lives_ok(
  $$select * from public.my_pending_approvals()$$,
  'the list a lead opens still builds');

select lives_ok(
  $$select * from public.sub_task_extension_requests$$,
  'and so does the extension view underneath it — the branch that was costing nine seconds');

select finish();
rollback;
