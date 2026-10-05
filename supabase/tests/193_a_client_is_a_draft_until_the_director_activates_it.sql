-- 20260928120000 (ADR-0123, I62.2 / I62.3 / I62.8) — a client is a draft until the account director activates it.
-- People: a001 Power Admin (holds clients:approve through the catalogue), a002 Traffic (clients:manage, no approve),
-- a003 a team member (neither).
begin;
select plan(18);
\ir helpers/seed.sql
-- The fixture tenant is made with the roles seed alone; provisioning (`public.seed_tenant_roles`) gives a new tenant
-- its countries the same way.
select app.seed_tenant_countries('aaaaaaaa-0000-0000-0000-000000000001');

create function pg_temp.as_person(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', (select jwt from test_claims where id = p), true);
end $$;
grant execute on function pg_temp.as_person(uuid) to authenticated;

select ok((select count(*) = 0 from clients where status = 'draft'), 'every client that existed before is active');
select is((select working_days from countries where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and code = 'IQ'),
          array[7,1,2,3,4]::smallint[], 'the tenant has its countries — Iraq works Sunday to Thursday');

set local role authenticated;

-- ---------------------------------------------------------------- Traffic starts a client: always a draft ----
select pg_temp.as_person('00000000-0000-0000-0000-00000000a002');
insert into clients (id, tenant_id, name, status, country_code, account_manager_id)
values ('aaaaaaaa-0000-0000-0000-000000193c01', 'aaaaaaaa-0000-0000-0000-000000000001', 'Luma 193', 'active', 'IQ',
        '00000000-0000-0000-0000-00000000a002');
select is((select status from clients where id = 'aaaaaaaa-0000-0000-0000-000000193c01'), 'draft',
  'someone without clients:approve saves a draft, even asking for active (d.1)');
select throws_ok($$ update clients set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000193c01' $$,
  '42501', 'client: only the account director activates a client (ADR-0123)', 'and cannot activate it');

-- ---------------------------------------------------------------- no work for a draft ----
select throws_ok($$
  insert into campaigns (tenant_id, client_id, name, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000193c01', 'For a draft', 'draft')
$$, '23514', null, 'a campaign cannot be raised for a draft client (d.2)');
select throws_ok($$
  insert into jobs (tenant_id, client_id, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000193c01', 'For a draft')
$$, '23514', null, 'nor a job');

-- ---------------------------------------------------------------- the director activates ----
select pg_temp.as_person('00000000-0000-0000-0000-00000000a001');
update clients set country_code = null where id = 'aaaaaaaa-0000-0000-0000-000000193c01';
select throws_ok($$ update clients set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000193c01' $$,
  '23514', null, 'activating needs a country');
update clients set country_code = 'AE' where id = 'aaaaaaaa-0000-0000-0000-000000193c01';
select lives_ok($$ update clients set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-000000193c01' $$,
  'the director activates a client with a name, a country and an account manager');
select is((select activated_by from clients where id = 'aaaaaaaa-0000-0000-0000-000000193c01'),
  '00000000-0000-0000-0000-00000000a001'::uuid, 'and the client records who activated it');
select throws_ok($$ update clients set status = 'draft' where id = 'aaaaaaaa-0000-0000-0000-000000193c01' $$,
  '55000', 'client: an active client does not go back to draft (ADR-0123)', 'an active client never goes back to draft');
select lives_ok($$
  insert into campaigns (tenant_id, client_id, name, status)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000193c01', 'For an active client', 'draft')
$$, 'once active, work can be raised for it');

-- ---------------------------------------------------------------- the rules lock on activation (d.5) ----
select pg_temp.as_person('00000000-0000-0000-0000-00000000a002');
select throws_ok($$
  update clients set profile = jsonb_build_object('rules', jsonb_build_array(jsonb_build_object('kind', 'do', 'text', 'Arabic leads')))
   where id = 'aaaaaaaa-0000-0000-0000-000000193c01'
$$, '42501', null, 'Traffic cannot change an active client''s dos and don''ts');
select lives_ok($$ update clients set name = 'Luma 193 (renamed)' where id = 'aaaaaaaa-0000-0000-0000-000000193c01' $$,
  'but still edits the rest of the client');
select pg_temp.as_person('00000000-0000-0000-0000-00000000a001');
select lives_ok($$
  update clients set profile = jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('kind', 'do', 'text', 'Arabic leads', 'languages', jsonb_build_array('ar', 'en'))))
   where id = 'aaaaaaaa-0000-0000-0000-000000193c01'
$$, 'the director can, and a rule carries its languages');

-- ---------------------------------------------------------------- the people at the client (d.4) ----
select pg_temp.as_person('00000000-0000-0000-0000-00000000a002');
select lives_ok($$
  insert into client_contacts (tenant_id, client_id, name, role_title, reach, can_request, signs_off)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000193c01', 'Khalid Hamdan', 'Marketing lead',
          array['whatsapp', 'email'], true, true)
$$, 'someone who manages clients records a person at the client');
select pg_temp.as_person('00000000-0000-0000-0000-00000000a003');
select throws_ok($$
  insert into client_contacts (tenant_id, client_id, name)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000193c01', 'Not allowed')
$$, '42501', null, 'a team member cannot');

-- ---------------------------------------------------------------- asking the director (20260928140000) ----
select pg_temp.as_person('00000000-0000-0000-0000-00000000a002');
insert into clients (id, tenant_id, name, country_code)
values ('aaaaaaaa-0000-0000-0000-000000193c02', 'aaaaaaaa-0000-0000-0000-000000000001', 'Draft 193', 'IQ');
update clients set activation_requested_at = now(), activation_requested_by = '00000000-0000-0000-0000-00000000a002'
 where id = 'aaaaaaaa-0000-0000-0000-000000193c02';
reset role;
select is((select count(*)::int from notifications
            where entity_id = 'aaaaaaaa-0000-0000-0000-000000193c02' and type = 'client_activation_requested'
              and user_id = '00000000-0000-0000-0000-00000000a001'), 1,
  'asking for activation tells whoever holds clients:approve');
select is((select count(*)::int from notifications
            where entity_id = 'aaaaaaaa-0000-0000-0000-000000193c02' and user_id = '00000000-0000-0000-0000-00000000a002'), 0,
  'and never the one who asked');

select * from finish();
rollback;
