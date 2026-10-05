-- ADR-0024/0026: in-app notifications — in-transaction emission (assignment + deliverable state
-- change), actor exclusion, recipient-scoped RLS, cross-tenant isolation. The broadcast trigger's
-- realtime.send is absent in CI and swallowed, so the rows still persist (proves the design).
begin;
select plan(10);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000051d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000051e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000051d1','Hero KV','in_progress', '00000000-0000-0000-0000-00000000a001');

set local role authenticated;

-- a002 assigns a sub-task to a003, then moves the deliverable into review
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
  values ('aaaaaaaa-0000-0000-0000-0000000051a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000051e1','00000000-0000-0000-0000-00000000a003','Retouch', 8) $$,
  'assign a sub-task (fires assignment notification)');
-- submit the sub-task so the deliverable can enter review (ADR-0030 gate)
-- ADR-0106 d.4 (I59.20): review is reached only through app.sub_task_submit; this fixture stands in
-- for it, so it raises the flag that function raises (as test_accept_campaign_work does for its fence).
select set_config('app.submitting', 'on', true);
update sub_tasks set status='review' where deliverable_id='aaaaaaaa-0000-0000-0000-0000000051e1';
select set_config('app.submitting', '', true);
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000051e1' $$,
  'move deliverable to in_review (fires review_requested)');

-- a003 (assignee) has exactly assigned + review_requested — rows durable despite no realtime
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications), 2, 'assignee received two notifications');
select is((select array_agg(type order by type) from notifications), array['assigned','review_requested'], 'correct notification types');

-- the actor (a002) is excluded and, being recipient-scoped, sees none
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select is((select count(*)::int from notifications), 0, 'actor is excluded and sees no notifications');

-- self-assignment does not notify the actor
select lives_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours)
  values ('aaaaaaaa-0000-0000-0000-0000000051a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000051e1','00000000-0000-0000-0000-00000000a002','Mine', 8) $$,
  'self-assign a sub-task');
select is((select count(*)::int from notifications), 0, 'self-assignment does not notify the actor');

-- cross-tenant isolation
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select is((select count(*)::int from notifications), 0, 'cross-tenant sees no notifications');

-- recipient marks one read → unread count drops
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ update notifications set read_at=now() where type='assigned' $$, 'recipient marks a notification read');
select is((select count(*)::int from notifications where read_at is null), 1, 'unread count reflects the read');

select * from finish();
rollback;
