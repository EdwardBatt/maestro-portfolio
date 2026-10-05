-- I30.7 — a notification names the work AND the campaign it belongs to (8 Sep).
--
-- `notifications.label` is written by fifteen separate emitters, so "Hero KV" reached a reader with
-- no way to know which campaign it belonged to. The campaign is now resolved centrally on insert
-- from `entity_type`/`entity_id`, which is the claim these assertions are about: one trigger has to
-- be right for all fifteen, and for every emitter added after it.
--
-- The NULL cases are as load-bearing as the resolved ones. Ad-hoc work must show its title alone
-- (d.2), and a campaign notification must not read "Ramadan 2027 — Ramadan 2027" (d.1).
begin;
select plan(8);
\ir helpers/seed.sql

-- A campaign deliverable and a task on it, alongside the seed's ad-hoc one (job-linked, no stream).
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000093d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','Launch');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000093e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000093d1','KV','in_progress','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000093a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000093e1','Retouch');
-- The seed's own deliverable f101 hangs off a JOB with stream_id null — the ad-hoc shape.
insert into sub_tasks (id, tenant_id, deliverable_id, title) values
  ('aaaaaaaa-0000-0000-0000-0000000093a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f101','Logo tweak');

reset role;

-- Written directly: what matters here is what the trigger resolves, not which emitter called it.
insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','Retouch',
   'sub_task','aaaaaaaa-0000-0000-0000-0000000093a1'),
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','KV',
   'deliverable','aaaaaaaa-0000-0000-0000-0000000093e1'),
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','Logo tweak',
   'sub_task','aaaaaaaa-0000-0000-0000-0000000093a2'),
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','Ramadan 2027',
   'campaign','aaaaaaaa-0000-0000-0000-00000000e001');

select is(
  (select context_label from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000093a1'),
  'Ramadan 2027',
  'a task notification carries the campaign it belongs to');

select is(
  (select context_label from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000093e1'),
  'Ramadan 2027',
  'a deliverable notification carries the campaign too (Edward: any reference to a deliverable)');

select is(
  (select context_label from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000093a2'),
  null,
  'ad-hoc work has no campaign and gets NO invented prefix (d.2)');

select is(
  (select context_label from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
  null,
  'a campaign notification is not prefixed with itself (d.1)');

-- An emitter that knows better than a join must not be overwritten.
insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, context_label) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','Retouch',
   'sub_task','aaaaaaaa-0000-0000-0000-0000000093a1','Stated by the emitter');
select is(
  (select context_label from notifications where label = 'Retouch' and context_label = 'Stated by the emitter'),
  'Stated by the emitter',
  'a context the emitter states itself survives the trigger');

-- A deleted or mistyped entity is a notification without context, never a failed transaction: this
-- trigger sits in the path of assignment, submission, approval and cancellation.
select lives_ok($$ insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003','assigned','Gone',
   'sub_task','aaaaaaaa-0000-0000-0000-00000093099f') $$,
  'an entity that cannot be resolved yields no context, not an error');

-- The emitter path, and the second half of the decision: a required resource is told the STEP that
-- was assigned. This labelled with `coalesce(deliverable.name, task.title)`, which is how an email
-- came to read "has assigned you to 'Creative'" — the container, not the work.
update resources set user_id = '00000000-0000-0000-0000-00000000a003' where id = 'aaaaaaaa-0000-0000-0000-00000000d001';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
insert into bookings (id, tenant_id, resource_id, sub_task_id, campaign_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-0000000093b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001',
   'aaaaaaaa-0000-0000-0000-0000000093a1','aaaaaaaa-0000-0000-0000-00000000e001','2027-03-01 13:00+00','2027-03-01 14:00+00',50);

reset role;
select is(
  (select label from notifications where type = 'resource_required'),
  'Retouch',
  'a required resource is told the TASK, not the deliverable that contains it');

select is(
  (select context_label from notifications where type = 'resource_required'),
  'Ramadan 2027',
  'and it still learns the campaign, through the same central resolution');

select * from finish();
rollback;
