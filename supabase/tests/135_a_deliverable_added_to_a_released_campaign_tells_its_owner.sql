-- I53.18 (21 Sep) — a deliverable added to a RELEASED campaign tells its new owner, and only them;
-- one added to a campaign still pending approval tells nobody (Action 1 will); the actor is never
-- told about their own addition.
begin;
select plan(9);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0b0', 'am135@a.test'),
  ('00000000-0000-0000-0000-00000000a0b1', 'lead135@a.test'),
  ('00000000-0000-0000-0000-00000000a0b2', 'tl135@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1350','aaaaaaaa-0000-0000-0000-000000000001','Creative 135');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a0b0','AM 135',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a0b1','Lead 135', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1350'),
  ('00000000-0000-0000-0000-00000000a0b2','TL 135',   'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1350')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a0b0','00000000-0000-0000-0000-00000000a0b1','00000000-0000-0000-0000-00000000a0b2');

-- A released campaign with one deliverable the lead already owns; a pending one beside it.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001350','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Released 135','approved','campaign','00000000-0000-0000-0000-00000000a0b0','{"proposition":"Go"}'::jsonb),
  ('aaaaaaaa-0000-0000-0000-000000001351','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Pending 135','pending_approval','campaign','00000000-0000-0000-0000-00000000a0b0','{"proposition":"Wait"}'::jsonb);
-- ADR-0116 d.3 (27 Sep): a campaign's pieces are added into a workstream.
insert into workstreams (tenant_id, campaign_id, name, department_id)
select tenant_id, id, 'Main work', 'aaaaaaaa-0000-0000-0000-0000000de0ff' from campaigns
 where id in ('aaaaaaaa-0000-0000-0000-000000001350', 'aaaaaaaa-0000-0000-0000-000000001351');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f135','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001350','Released 135');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1350','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f135',
   'Existing 135','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a0b1');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0b0'),true);

-- 1. The AM adds a deliverable owned by the team lead on the RELEASED campaign.
select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001350', 'Key visual 135',
    '00000000-0000-0000-0000-00000000a0b2', null, 3, now() + interval '12 days', p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001350' limit 1))
$$, 'the account manager adds a deliverable to a released campaign');

reset role;
select is(
  (select count(*)::int from notifications n
     join deliverables d on d.id = n.entity_id
    where n.type = 'deliverable_added' and d.name = 'Key visual 135'),
  1, 'exactly ONE deliverable_added row is written for the new deliverable');
select is(
  (select n.user_id from notifications n join deliverables d on d.id = n.entity_id
    where n.type = 'deliverable_added' and d.name = 'Key visual 135'),
  '00000000-0000-0000-0000-00000000a0b2'::uuid,
  'and it is addressed to the NEW OWNER');
select results_eq($$
  select n.entity_type, n.label, (n.detail ->> 'for_owner')::boolean, n.actor_id
    from notifications n join deliverables d on d.id = n.entity_id
   where n.type = 'deliverable_added' and d.name = 'Key visual 135'
$$, $$ values ('deliverable', 'Key visual 135', true, '00000000-0000-0000-0000-00000000a0b0'::uuid) $$,
  'it points at the deliverable, names it, carries for_owner and the actor (Action 15 words)');
select is(
  (select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000a0b1' and type = 'deliverable_added'),
  0, 'the EXISTING owner on the campaign is not told — only changes to their own deliverables reach them (Edward, 21 Sep)');
select is(
  (select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000a0b0' and type = 'deliverable_added'),
  0, 'the account manager who added it is not told');

-- 2. The AM adds a deliverable they own themselves: nobody is told about their own action.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0b0'),true);
select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001350', 'Own 135',
    '00000000-0000-0000-0000-00000000a0b0', null, 1, now() + interval '12 days', p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001350' limit 1))
$$, 'a deliverable the actor owns themselves is added');
-- 3. On a PENDING campaign nothing is sent now — Action 1 tells the owner at approval.
select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001351', 'Early 135',
    '00000000-0000-0000-0000-00000000a0b2', null, 1, now() + interval '12 days', p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001351' limit 1))
$$, 'a deliverable is added to a campaign still pending approval');
reset role;
select is(
  (select count(*)::int from notifications n
     join deliverables d on d.id = n.entity_id
    where n.type = 'deliverable_added' and d.name in ('Own 135', 'Early 135')),
  0, 'neither the actor''s own deliverable nor one on a pending campaign writes a row');

select * from finish();
rollback;
