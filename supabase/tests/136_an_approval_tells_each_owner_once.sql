-- I53.19 (21 Sep) — approving a campaign tells each owner ONCE, on the campaign, with the count and
-- the names of what they own; the approver is never told; an owner with one piece is told once too.
begin;
select plan(8);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0c0', 'am136@a.test'),
  ('00000000-0000-0000-0000-00000000a0c1', 'lead136@a.test'),
  ('00000000-0000-0000-0000-00000000a0c2', 'tl136@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1360','aaaaaaaa-0000-0000-0000-000000000001','Creative 136');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a0c0','AM 136',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a0c1','Lead 136', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1360'),
  ('00000000-0000-0000-0000-00000000a0c2','TL 136',   'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1360')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a0c0';

-- A pending campaign: the team lead owns three deliverables, the department lead one.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001360','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 136','pending_approval','campaign','00000000-0000-0000-0000-00000000a0c0','{"proposition":"Four draws"}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f136','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001360','Season 136');
insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, created_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f136','Teaser 136','draft', now() + interval '5 days',  '00000000-0000-0000-0000-00000000a0c2', now() - interval '3 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f136','Posts 136', 'draft', now() + interval '12 days', '00000000-0000-0000-0000-00000000a0c2', now() - interval '2 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f136','Reels 136', 'draft', now() + interval '20 days', '00000000-0000-0000-0000-00000000a0c2', now() - interval '1 minute'),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f136','KV 136',    'draft', now() + interval '9 days',  '00000000-0000-0000-0000-00000000a0c1', now());

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0c0'),true);
select lives_ok($$ select app.approve_campaign('aaaaaaaa-0000-0000-0000-000000001360') $$, 'the account manager approves');
reset role;

select is(
  (select count(*)::int from notifications where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'),
  2, 'TWO rows for four deliverables — one per OWNER (I53.19), not one per deliverable');
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'
      and user_id = '00000000-0000-0000-0000-00000000a0c2'),
  1, 'the owner of three pieces is told exactly once');
select results_eq($$
  select entity_type, label, (detail ->> 'deliverable_count')::int,
         (select jsonb_agg(e ->> 'name') from jsonb_array_elements(detail -> 'deliverables') e)
    from notifications
   where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'
     and user_id = '00000000-0000-0000-0000-00000000a0c2'
$$, $$ values ('campaign', 'Season 136', 3, '["Teaser 136","Posts 136","Reels 136"]'::jsonb) $$,
  'the row is on the CAMPAIGN, names it, and carries the count and the names of what they own (in order)');
-- 20260921150000: each piece carries its due date and its phase (none here — the campaign has no phases).
select results_eq($$
  select e ->> 'name', (e ->> 'due_at')::timestamptz = d.due_at, e -> 'phase_number', e -> 'phase_name'
    from notifications n, jsonb_array_elements(n.detail -> 'deliverables') e
    join deliverables d on d.name = e ->> 'name'
   where n.type = 'campaign_approved' and n.entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'
     and n.user_id = '00000000-0000-0000-0000-00000000a0c2'
   order by e ->> 'name'
$$, $$ values ('Posts 136', true, 'null'::jsonb, 'null'::jsonb), ('Reels 136', true, 'null'::jsonb, 'null'::jsonb), ('Teaser 136', true, 'null'::jsonb, 'null'::jsonb) $$,
  'each piece carries its own due date, and its phase where the campaign has phases');
select is(
  (select detail ->> 'due_at' from notifications
    where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'
      and user_id = '00000000-0000-0000-0000-00000000a0c2')::timestamptz,
  (select min(due_at) from deliverables where name in ('Teaser 136','Posts 136','Reels 136')),
  'the facts line gets the EARLIEST due date of theirs');
select results_eq($$
  select (detail ->> 'deliverable_count')::int from notifications
   where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001360'
     and user_id = '00000000-0000-0000-0000-00000000a0c1'
$$, $$ values (1) $$, 'the owner of one piece is told once, with a count of one');
select is(
  (select count(*)::int from notifications where type = 'campaign_approved' and user_id = '00000000-0000-0000-0000-00000000a0c0'),
  0, 'the approver is not told about their own approval');

select * from finish();
rollback;
