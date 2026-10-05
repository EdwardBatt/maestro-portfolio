-- I56.11 (Q4) — a piece's date can be marked as given to the client. `20260924140000`.
--
-- A MARKER only: one boolean on the deliverable, written by the wizard's one content writer
-- (ADR-0067). Set when the payload says so, false when it says nothing — so every caller that
-- predates the field (the seed, pgTAP 102's positional call, the single job) writes exactly what it
-- wrote before.
begin;
select plan(4);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a550', 'am155@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
values ('00000000-0000-0000-0000-00000000a550', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM 155',
        (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager'),
        'aaaaaaaa-0000-0000-0000-0000000de0ff');
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a550';

select has_column('public', 'deliverables', 'is_given_to_client', 'deliverables carries the given-to-client marker');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a550'),true);

select lives_ok($$
  select public.create_campaign_from_brief(
    'aaaaaaaa-0000-0000-0000-00000000c001', null, 'Season 155',
    '{"languages":["en"],"proposition":"p"}'::jsonb, null,
    '[{"name":"Told piece 155","ownerUserId":"00000000-0000-0000-0000-00000000a550",
       "quantity":"1","dueAt":"2026-10-01T15:00:00Z","isGivenToClient":true,"workstreamKey":"w"},
      {"name":"Quiet piece 155","ownerUserId":"00000000-0000-0000-0000-00000000a550",
       "quantity":"1","dueAt":"2026-10-02T15:00:00Z","workstreamKey":"w"}]'::jsonb,
    '00000000-0000-0000-0000-00000000a550',
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'the wizard''s one-shot call takes the marker');

select is((select is_given_to_client from deliverables where name = 'Told piece 155'), true,
  'a piece marked given to the client is stored as given');
select is((select is_given_to_client from deliverables where name = 'Quiet piece 155'), false,
  'a piece the payload says nothing about is not given — the default');

select * from finish();
rollback;
