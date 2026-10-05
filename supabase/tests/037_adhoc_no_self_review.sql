-- L6.5 (ADR-0036): after reverting the TEMP alpha toggles (TMP.2), per-deliverable reviewer
-- authority is gone — review moderation is `reviews:moderate`-only again and the per-deliverable
-- reviewer-authority helper was dropped (its cases are covered by the standard moderation tests).
-- The ONE permanent guard from that era is retained and re-proven here:
-- create_adhoc_deliverable rejects reviewer = assignee (no self-review). Using a001 (power_admin,
-- holds reviews:moderate + tenant scope) as caller/assignee/reviewer isolates the self-review guard
-- as the only failing check — so this also catches a revert that accidentally drops it.
begin;
select plan(1);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select throws_ok(
  $$ select public.create_adhoc_deliverable(
       '00000000-0000-0000-0000-00000000a001'::uuid, 'self', 1.0, now(), now() + interval '1 day',
       '00000000-0000-0000-0000-00000000a001'::uuid) $$,
  '22023', null, 'create_adhoc_deliverable rejects reviewer = assignee (no self-review, permanent)');

select finish();
rollback;
