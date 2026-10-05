-- ADR-0028: email slow lane. The email trigger `app.tg_notification_email` best-effort enqueues a
-- notify-email call via pg_net — which is ABSENT in CI. This test proves the guard: with the email
-- trigger attached, emissions still commit and the notification rows persist (email never gates
-- correctness), and the lane (function + trigger) is wired.
begin;
select plan(5);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000052d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000052e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000052d1','Key Visual','in_progress', '00000000-0000-0000-0000-00000000a001');

-- the email lane is wired: function + AFTER INSERT trigger on notifications
select has_function('app', 'tg_notification_email', 'email slow-lane trigger function exists');
select trigger_is('public', 'notifications', 'notification_email', 'app', 'tg_notification_email',
  'notification_email AFTER INSERT trigger is attached');

set local role authenticated;

-- an emission fires BOTH the broadcast trigger and the email trigger; in CI net.http_post is absent,
-- so the guarded email trigger no-ops and the insert still commits.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
  values ('aaaaaaaa-0000-0000-0000-0000000052a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000052e1','00000000-0000-0000-0000-00000000a003','Comp', 8) $$,
  'assignment commits with the email trigger attached (guard no-ops in CI)');
-- submit the sub-task so the deliverable can enter review (ADR-0030 gate)
-- ADR-0106 d.4 (I59.20): review is reached only through app.sub_task_submit; this fixture stands in
-- for it, so it raises the flag that function raises (as test_accept_campaign_work does for its fence).
select set_config('app.submitting', 'on', true);
update sub_tasks set status='review' where deliverable_id='aaaaaaaa-0000-0000-0000-0000000052e1';
select set_config('app.submitting', '', true);
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000052e1' $$,
  'review-request (a high-signal email type) commits with the email trigger attached');

-- the notification rows persisted regardless of the (absent) email lane
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where type in ('assigned','review_requested')), 2,
  'notification rows persist — email is a best-effort second channel, never a gate');

select * from finish();
rollback;
