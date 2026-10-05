-- ADR-0024 (Phase I) deliverable lifecycle guard. Proves the transition graph, authority
-- (project_tasks:manage vs reviews:moderate for sign-off), server-stamped revision rounds,
-- reviewer column-freeze, append-only event emission, and cross-tenant isolation.
begin;
select plan(15);
\ir helpers/seed.sql

-- Make a003 a reviewer-ONLY actor for the freeze/authority tests: team_member ships with
-- project_tasks:manage (makers progress their own work), so grant reviews:moderate and strip
-- project_tasks:manage — leaving reviews:moderate only. Transaction-scoped (rolled back).
insert into role_grants (tenant_id, role_id, resource, action)
select 'aaaaaaaa-0000-0000-0000-000000000001',
       (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'),
       'reviews', 'moderate';
delete from role_grants
 where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member')
   and resource = 'project_tasks' and action = 'manage';

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000a701', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Lifecycle');
-- deliverables seeded directly in a starting state (the guard fires on UPDATE, not INSERT).
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000a801', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a701', 'Happy', 'draft', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-00000000a802', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a701', 'Reject', 'in_review', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-00000000a803', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a701', 'Block', 'in_progress', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-00000000a804', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a701', 'RevOnly', 'in_review', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-00000000a805', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000a701', 'Iso', 'draft', '00000000-0000-0000-0000-00000000a001');

set local role authenticated;

-- ---- scheduler (project_tasks:manage, NOT reviews:moderate) ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-00000000a801' $$,
  'scheduler: draft -> in_progress');
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-00000000a801'),
  'in_progress', 'happy deliverable advanced');
-- ADR-0077 d.2: in_progress -> approved is no longer an ILLEGAL transition — a container closes
-- when its contents are done. It is still refused here, and for the better reason: this deliverable
-- has no approved task, so there is nothing to roll up and the ordinary sign-off authority applies.
select throws_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-00000000a801' $$,
  '42501', null, 'in_progress -> approved with nothing approved still needs reviews:moderate');
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-00000000a801' $$,
  'scheduler: in_progress -> in_review');
select throws_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-00000000a801' $$,
  '42501', null, 'scheduler cannot sign off (no reviews:moderate)');

-- ---- power_admin (both grants) ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-00000000a801' $$,
  'power_admin signs off (in_review -> approved)');
select is((select count(*)::int from sla_events where deliverable_id='aaaaaaaa-0000-0000-0000-00000000a801' and event_type='approved'),
  1, 'approved event logged');

-- revision loop: reject increments revision_round + logs revision_requested
select lives_ok($$ update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-00000000a802' $$,
  'power_admin sends back (in_review -> in_progress)');
select is((select revision_round from deliverables where id='aaaaaaaa-0000-0000-0000-00000000a802'),
  1, 'revision_round incremented server-side');
select is((select count(*)::int from sla_events where deliverable_id='aaaaaaaa-0000-0000-0000-00000000a802' and event_type='revision_requested'),
  1, 'revision_requested event logged');

-- block / unblock events
select lives_ok($$ update deliverables set state='blocked' where id='aaaaaaaa-0000-0000-0000-00000000a803' $$,
  'in_progress -> blocked');
select is((select count(*)::int from sla_events where deliverable_id='aaaaaaaa-0000-0000-0000-00000000a803' and event_type in ('blocked_flagged')),
  1, 'blocked_flagged event logged');

-- ---- reviewer-only (a003: reviews:moderate only) ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ update deliverables set state='in_progress', name='hacked' where id='aaaaaaaa-0000-0000-0000-00000000a804' $$,
  '42501', null, 'reviewer-only cannot edit non-state columns (freeze)');
select lives_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-00000000a804' $$,
  'reviewer-only may sign off');

-- ---- cross-tenant isolation: B cannot touch A's deliverable (RLS → 0 rows, no error) ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-00000000a805';
-- read back as a tenant-A user (B cannot even see A's row — that's the point), so the
-- assertion checks the row is genuinely unchanged rather than merely invisible.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-00000000a805'),
  'draft', 'cross-tenant update blocked by RLS (still draft, verified in tenant A)');

select * from finish();
rollback;
