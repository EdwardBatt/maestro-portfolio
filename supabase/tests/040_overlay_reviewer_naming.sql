-- L6.7 (ADR-0036): a `reviews:moderate` granted via the per-user overlay makes someone a NAMEABLE
-- ad-hoc reviewer — create_adhoc_deliverable's reviewer check is overlay-aware via
-- app.user_holds_permission (role grant OR user allow, minus user deny). Seed (tenant A):
-- a001 power_admin (holds user_grants:manage + reviews:moderate), a002 scheduler (holds NEITHER),
-- a003 team_member (the assignee). Caller throughout is a001.
begin;
select plan(4);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- 1) baseline: a scheduler holds no reviews:moderate (by role or overlay) → cannot be named reviewer.
select throws_ok(
  $$ select public.create_adhoc_deliverable(
       '00000000-0000-0000-0000-00000000a003'::uuid, 't1', 1.0, now(), now() + interval '1 day',
       '00000000-0000-0000-0000-00000000a002'::uuid) $$,
  '22023', null, 'a scheduler (no reviews:moderate) cannot be named an ad-hoc reviewer');

-- 2) grant a002 reviews:moderate via the per-user overlay.
select lives_ok(
  $$ insert into user_grants (tenant_id, user_id, resource, action, effect)
     values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a002', 'reviews', 'moderate', 'allow') $$,
  'admin grants reviews:moderate via the per-user overlay');

-- 3) now the overlay-granted user CAN be named the reviewer (naming succeeds).
select lives_ok(
  $$ select public.create_adhoc_deliverable(
       '00000000-0000-0000-0000-00000000a003'::uuid, 't2', 1.0, now(), now() + interval '1 day',
       '00000000-0000-0000-0000-00000000a002'::uuid) $$,
  'an overlay reviews:moderate holder can be named an ad-hoc reviewer');

-- 4) a per-user DENY wins: replace the allow with a deny → naming is refused again.
delete from user_grants where user_id = '00000000-0000-0000-0000-00000000a002' and resource = 'reviews' and action = 'moderate';
insert into user_grants (tenant_id, user_id, resource, action, effect)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a002', 'reviews', 'moderate', 'deny');
select throws_ok(
  $$ select public.create_adhoc_deliverable(
       '00000000-0000-0000-0000-00000000a003'::uuid, 't3', 1.0, now(), now() + interval '1 day',
       '00000000-0000-0000-0000-00000000a002'::uuid) $$,
  '22023', null, 'a per-user deny removes reviewer eligibility (deny wins)');

select finish();
rollback;
