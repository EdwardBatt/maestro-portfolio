-- I57.44 (25 Sep) — a new owner is told what is actually owed.
--
-- The owner-change notice records whether the deliverable's work can already be assigned
-- (`detail.tasks_approved`): false while its task list waits for an owner, true once it was approved
-- — an owner change does not reset that approval, so the new owner owes nothing then. The old owner's
-- one-line notice is unchanged.
begin;
select plan(4);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1590', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 159');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a190', 'am159@a.test'),
  ('00000000-0000-0000-0000-00000000a191', 'leadone159@a.test'),
  ('00000000-0000-0000-0000-00000000a192', 'leadtwo159@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a190','AM 159',       'account_manager', null),
  ('00000000-0000-0000-0000-00000000a191','Lead one 159', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1590'),
  ('00000000-0000-0000-0000-00000000a192','Lead two 159', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1590')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a190';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at) values
  ('aaaaaaaa-0000-0000-0000-000000001590','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 159','approved','campaign','00000000-0000-0000-0000-00000000a190', now());
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f159','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001590','Season 159');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1590','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f159',
   'Waiting 159','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a191'),
  ('aaaaaaaa-0000-0000-0000-0000000d1591','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f159',
   'Accepted 159','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a191');
-- The second one's list was approved by its first owner.
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = now(), tasks_approved_by = '00000000-0000-0000-0000-00000000a191'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1591';
select set_config('app.task_list_approval', '', true);

-- The account manager hands both to the second lead.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a190'),true);
update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a192'
 where id in ('aaaaaaaa-0000-0000-0000-0000000d1590','aaaaaaaa-0000-0000-0000-0000000d1591');
reset role;

select is((select (detail->>'tasks_approved')::boolean from notifications
            where type = 'deliverable_reassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1590'),
  false, 'a list still waiting: the new owner is told it is theirs to approve (I57.44)');
select is((select (detail->>'tasks_approved')::boolean from notifications
            where type = 'deliverable_reassigned' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1591'),
  true, 'a list already approved: the new owner owes nothing — the notice says so (I57.44)');
select ok((select tasks_approved_at is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1591'),
  'the owner change did not reset the approval — which is why the notice has to say it');
select is((select count(*)::int from notifications
            where type = 'deliverable_owner_removed' and user_id = '00000000-0000-0000-0000-00000000a191'),
  2, 'the old owner still gets their one line for each');

select * from finish();
rollback;
