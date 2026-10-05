-- ADR-0042 d.6 (I13.1 d): a contested resource raises, it does not block.
--
-- The ADR said a clash "raises an exception" and that exceptions reach the Traffic Manager and the
-- Account Manager. There is no exceptions table on this project — `ExceptionsPanel` recomputes
-- counts from the viewer's own open work. Decided 26 Aug: the RECORD of a clash is the booking
-- itself (tentative for an exclusive resource, confirmed-and-over-ceiling for a person, both already
-- visible on the grid) and the ALERT is a notification. This suite covers the alert.
--
-- What matters here: the RPC is SECURITY DEFINER and inserts into a table with no user INSERT
-- policy, so its own gate is the only thing standing between it and being an open notification
-- cannon. Assertion 2 is the one that matters.
--
-- Subjects: a001 power_admin (tenant scope) · a002 Booker A / scheduler (tenant scope, may manage)
-- · a003 Creative A / team_member (scope 'self' — holds project_tasks:manage from the seed ON
-- PURPOSE, so a refusal proves scope decided it, not the grant).

begin;
select plan(10);
\ir helpers/seed.sql

-- The account manager for the client behind job f001, so deliverable_account_manager resolves.
update clients set account_manager_id = '00000000-0000-0000-0000-00000000a003'
 where id = 'aaaaaaaa-0000-0000-0000-00000000c001';

insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000054e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Clash54','00000000-0000-0000-0000-00000000a001');
-- `assigned_by` is SERVER-CONTROLLED (20260823130000): a trigger stamps auth.uid() on assign and
-- ignores whatever the insert supplied. A seed-context insert has no auth.uid(), so passing a002
-- explicitly would silently leave it NULL and the assigner would never be notified. The task is
-- therefore created BY a002 — scheduler, tenant scope — which is also how it happens in real use.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000054a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000054e1','00000000-0000-0000-0000-00000000a003','Shoot day','todo', 8);
reset role;

select is((select assigned_by from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000054a1'),
  '00000000-0000-0000-0000-00000000a002'::uuid,
  'the stamp recorded a002 as the assigner — without this the rest of the suite proves nothing');

-- ------------------------------------------------- the type is allowed at all ----
select lives_ok(
  $$insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a001',
            'resource_clash','RED Camera','sub_task','aaaaaaaa-0000-0000-0000-0000000054a1')$$,
  'resource_clash passes the notifications type check');
delete from notifications where type = 'resource_clash';

-- ============================================================ the gate ====
-- a003 is the ASSIGNEE and holds project_tasks:manage, so if scope were not doing the work here
-- this would succeed and any authenticated user could spray notifications at will.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$select public.notify_resource_clash('aaaaaaaa-0000-0000-0000-0000000054a1',
                                        'aaaaaaaa-0000-0000-0000-00000000d002')$$,
  '42501', null,
  'someone who cannot manage the task cannot raise a clash against it');
reset role;
select is((select count(*)::int from notifications where type = 'resource_clash'), 0,
  'and nothing was written');
set local role authenticated;

-- ============================================ who hears about it ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select is(
  (select public.notify_resource_clash('aaaaaaaa-0000-0000-0000-0000000054a1',
                                       'aaaaaaaa-0000-0000-0000-00000000d002')), 2,
  'the assigner and the account manager are both told');

-- Read as the table owner. `notifications_recipient_select` shows a user only their OWN inbox, so
-- counting these as a001 would return zero for every recipient and look like nothing was written.
reset role;
select is(
  (select count(*)::int from notifications
    where type = 'resource_clash' and user_id = '00000000-0000-0000-0000-00000000a002'), 1,
  'the assigner — they chose the dates, so they can move them');
select is(
  (select count(*)::int from notifications
    where type = 'resource_clash' and user_id = '00000000-0000-0000-0000-00000000a003'), 1,
  'the account manager for the deliverable');

select is((select label from notifications where type = 'resource_clash' limit 1), 'RED Camera',
  'the label names the RESOURCE — "the camera is contested" is the message');
set local role authenticated;

-- --------------------------------------------------- the actor is never told ----
-- Telling somebody about the clash they just caused, at the moment they caused it, is noise: the
-- refusal is already on their screen.
reset role;
delete from notifications where type = 'resource_clash';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a002'), true);
select is(
  (select public.notify_resource_clash('aaaaaaaa-0000-0000-0000-0000000054a1',
                                       'aaaaaaaa-0000-0000-0000-00000000d002')), 1,
  'the assigner raising it themselves notifies only the account manager, not themselves');

-- --------------------------------------------------------- tenant fence ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$select public.notify_resource_clash('aaaaaaaa-0000-0000-0000-0000000054a1',
                                        'bbbbbbbb-0000-0000-0000-00000000d001')$$,
  'P0002', null,
  'a clash cannot name another tenant''s resource');

select * from finish();
rollback;
