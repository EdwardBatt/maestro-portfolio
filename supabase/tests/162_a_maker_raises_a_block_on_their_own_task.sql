-- I59.21 (ADR-0107 d.1, d.2) — a maker raises "I'm blocked" on their OWN task; the maker or the
-- deliverable's owner clears it; nobody else gains anything.
--
-- Adversarial: the rights are proven for callers WITHOUT project_tasks:manage, because that
-- permission already opened every write on this table (`deliverable_pending_inputs_manage_write`).
-- The fixture's team_member grant is removed (production has none, 20260825110000), and the owner
-- is given a per-user DENY (ADR-0036 overlay) so the owner's right is the new policy's, not the
-- manage one's.
begin;
select plan(22);
\ir helpers/seed.sql

delete from role_grants
 where resource = 'project_tasks' and action = 'manage'
   and role_id in (select id from roles where key = 'team_member');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a162', 'lead162@a.test'),
  ('00000000-0000-0000-0000-00000000a163', 'maker162@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid
from (values
  ('00000000-0000-0000-0000-00000000a162','Lead 162','department_lead'),
  ('00000000-0000-0000-0000-00000000a163','Maker 162','team_member')
) as v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a162','00000000-0000-0000-0000-00000000a163');
-- tg_stamp_granted_by forces granted_by = auth.uid() (NOT NULL), so the grant goes in as the admin
-- (038's pattern); the claims are cleared again straight after, so the fixture below is the superuser's.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect) values
  ('aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a162','project_tasks','manage','deny');
select set_config('request.jwt.claims', '', true);

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f162','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S162');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1620','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f162',
   'Poster 162','in_progress','00000000-0000-0000-0000-00000000a162','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d1621','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f162',
   'Banner 162','in_progress','00000000-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-0000000de0ff','00000000-0000-0000-0000-00000000a001');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000016d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620','Design','00000000-0000-0000-0000-00000000a003','in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016d2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620','Arabic copy','00000000-0000-0000-0000-00000000a163','in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-0000000016d3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1621','Banner design','00000000-0000-0000-0000-00000000a003','in_progress', 8);

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);

select ok(not app.has_permission('project_tasks', 'manage'), 'fixture: the maker holds no project_tasks:manage');

-- ================================================================ raising (d.2) ====
select lives_ok($$ insert into deliverable_pending_inputs
    (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from, requested_at, created_by)
  values ('aaaaaaaa-0000-0000-0000-0000000016e1','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000d1620','aaaaaaaa-0000-0000-0000-0000000016d1',
          'copy','The Arabic headline','Maker 162', now() - interval '3 days', '00000000-0000-0000-0000-00000000a001') $$,
  'the assignee raises a block on their own task');
select ok((select requested_at = now() and created_by = '00000000-0000-0000-0000-00000000a003' and satisfied_at is null
             from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e1'),
  'the server stamps when and who — a back-dated requested_at and a borrowed created_by are ignored');
select lives_ok($$ insert into deliverable_pending_inputs
    (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-0000000016e2','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000d1620','aaaaaaaa-0000-0000-0000-0000000016d1',
          'client','Approved product shots','Kite Card') $$,
  'a second block on the same task');

select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d2','copy','Something','Someone') $$,
  '42501', null, 'not on somebody else''s task');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620','copy','Logo pack','Kite Card') $$,
  '42501', null, 'not on the whole deliverable — that stays the manager''s (ADR-0069 d.7)');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d1','copy','Logo pack', '  ') $$,
  '42501', null, 'who has it is required');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d1','copy','', 'Kite Card') $$,
  '42501', null, 'what is missing is required');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d3','Logo pack', 'Kite Card') $$,
  '23514', null, 'a task of another deliverable is refused — the task must be on the input''s deliverable');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d1','mood','Logo pack', 'Kite Card') $$,
  '23514', null, 'kind is one of copy · client · file · decision · other');
select throws_ok($$ insert into deliverable_pending_inputs
    (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
  values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1620',
          'aaaaaaaa-0000-0000-0000-0000000016d1','copy','Logo pack', 'Kite Card') $$,
  '42501', null, 'never tagged to another tenant');

-- ================================================================ clearing (d.2) ====
select throws_ok($$ update deliverable_pending_inputs set description = 'Anything'
                    where id = 'aaaaaaaa-0000-0000-0000-0000000016e1' $$,
  '42501', null, 'the maker may clear their block, not rewrite it');
select throws_ok($$ update deliverable_pending_inputs set requested_at = now() - interval '9 days'
                    where id = 'aaaaaaaa-0000-0000-0000-0000000016e1' $$,
  '42501', null, '…nor move when it was raised (it measures the blocked time)');
delete from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e1';
select is((select count(*)::int from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e1'), 1,
  'nor delete it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a163'),true);
update deliverable_pending_inputs set satisfied_at = now() where id = 'aaaaaaaa-0000-0000-0000-0000000016e1';
select ok((select satisfied_at is null from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e1'),
  'another maker on the same deliverable cannot clear it');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ update deliverable_pending_inputs set satisfied_at = now() + interval '2 days'
                   where id = 'aaaaaaaa-0000-0000-0000-0000000016e1' $$,
  'the maker clears their own block');
select ok((select satisfied_at = now() from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e1'),
  '…stamped now, whatever the caller sent');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a162'),true);
select ok(not app.has_permission('project_tasks', 'manage'), 'fixture: the owner is denied project_tasks:manage');
select lives_ok($$ update deliverable_pending_inputs set satisfied_at = now()
                   where id = 'aaaaaaaa-0000-0000-0000-0000000016e2' $$,
  'the deliverable''s owner clears the maker''s block');
select ok((select satisfied_at is not null from deliverable_pending_inputs where id = 'aaaaaaaa-0000-0000-0000-0000000016e2'),
  '…and it is cleared');

-- ================================================================ isolation ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*)::int from deliverable_pending_inputs where sub_task_id is not null), 0,
  'tenant B sees none of it');

-- ================================================================ the audit stays ====
reset role;
select is((select count(*)::int from audit_events
            where entity = 'deliverable_pending_inputs' and action = 'insert'
              and entity_id in ('aaaaaaaa-0000-0000-0000-0000000016e1','aaaaaaaa-0000-0000-0000-0000000016e2')), 2,
  'both raises are in the audit log');

select * from finish();
rollback;
