-- 20261001110000 (ADR-0120 addendum, Edward 1 Oct) — the Dev panel is the permission `dev_view:view`, and who may be viewed
-- follows the holder's own role reach.
--
--   GRANT    — the CEO role holds it; a person without it is refused and offered nothing.
--   REACH    — an organisation-wide holder (CEO) views anyone in the tenant; a department-scoped holder (a Department Lead
--              given it per person) views their own department and is refused another; nobody views themselves.
--   OPTIONS  — `view_as_options` answers for the REAL person, also while they are viewing someone (`view_as_by`).
-- The hook is driven as PostgREST drives it, as in 191.
begin;
select plan(10);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de2091', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dept One 209'),
  ('aaaaaaaa-0000-0000-0000-000000de2092', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dept Two 209');
insert into auth.users (id, email, raw_app_meta_data)
select v.id::uuid, v.email, jsonb_build_object('tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001') from (values
  ('00000000-0000-0000-0000-00000000c090','ceo209@a.test'),
  ('00000000-0000-0000-0000-00000000c091','lead1-209@a.test'),
  ('00000000-0000-0000-0000-00000000c092','lead2-209@a.test'),
  ('00000000-0000-0000-0000-00000000c093','maker1-209@a.test'),
  ('00000000-0000-0000-0000-00000000c094','maker2-209@a.test')) v(id, email);
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000c090','CEO 209',    'ceo',             'aaaaaaaa-0000-0000-0000-000000de2092'),
  ('00000000-0000-0000-0000-00000000c091','Lead1 209',  'department_lead', 'aaaaaaaa-0000-0000-0000-000000de2091'),
  ('00000000-0000-0000-0000-00000000c092','Lead2 209',  'department_lead', 'aaaaaaaa-0000-0000-0000-000000de2092'),
  ('00000000-0000-0000-0000-00000000c093','Maker1 209', 'team_member',     'aaaaaaaa-0000-0000-0000-000000de2091'),
  ('00000000-0000-0000-0000-00000000c094','Maker2 209', 'team_member',     'aaaaaaaa-0000-0000-0000-000000de2092')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000c09%';
-- "should C-level require, maybe extend to Department Leads for their departments": Lead1 is given it per person.
-- As an admin: tg_stamp_granted_by forces granted_by = auth.uid() (see 038).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000c091', 'dev_view', 'view', 'allow');

create function pg_temp.view_as_err(p_caller uuid, p_header text, out uid uuid, out err_state text)
language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims', (select jwt from test_claims where id = p_caller), true);
    perform set_config('request.headers', json_build_object('x-maestro-view-as', p_header)::text, true);
    perform public.view_as_pre_request();
    uid := auth.uid();
    raise exception 'undo' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then err_state := sqlstate;
  end;
end $$;
grant execute on function pg_temp.view_as_err(uuid, text) to authenticated;

-- ================================================================ GRANT ====
select ok(exists (select 1 from role_grants rg join roles r on r.id = rg.role_id
                   where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'ceo'
                     and rg.resource = 'dev_view' and rg.action = 'view'),
  'grant: the CEO role holds dev_view:view');

set local role authenticated;

select is((select err_state from pg_temp.view_as_err('00000000-0000-0000-0000-00000000c092', '00000000-0000-0000-0000-00000000c094')), '42501',
  'grant: a Department Lead without it is refused, even in their own department');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000c093'), true);
select is(public.view_as_options() -> 'allowed', 'false'::jsonb, 'grant: a person without it is offered nothing');

-- ================================================================ REACH ====
select is((select uid from pg_temp.view_as_err('00000000-0000-0000-0000-00000000c090', '00000000-0000-0000-0000-00000000c093')),
  '00000000-0000-0000-0000-00000000c093'::uuid, 'reach: the CEO views a person in another department');
select is((select uid from pg_temp.view_as_err('00000000-0000-0000-0000-00000000c091', '00000000-0000-0000-0000-00000000c093')),
  '00000000-0000-0000-0000-00000000c093'::uuid, 'reach: a Department Lead holding it views their own department');
select is((select err_state from pg_temp.view_as_err('00000000-0000-0000-0000-00000000c091', '00000000-0000-0000-0000-00000000c094')), '42501',
  'reach: and is refused a person in another department');
select is((select err_state from pg_temp.view_as_err('00000000-0000-0000-0000-00000000c090', '00000000-0000-0000-0000-00000000c090')), '42501',
  'reach: nobody views themselves');

-- ============================================================== OPTIONS ====
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000c091'), true);
select set_eq($$ select (p ->> 'id')::uuid from jsonb_array_elements(public.view_as_options() -> 'people') p $$,
  array['00000000-0000-0000-0000-00000000c093'::uuid],
  'options: the Department Lead is offered exactly their department''s people, not themselves');

select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000c090'), true);
select ok((select bool_and(p ->> 'id' <> '00000000-0000-0000-0000-00000000c090')
             and bool_or(p ->> 'id' = '00000000-0000-0000-0000-00000000c094')
             and bool_or(p ->> 'id' = '00000000-0000-0000-0000-00000000c093')
             from jsonb_array_elements(public.view_as_options() -> 'people') p),
  'options: the CEO is offered both departments, not themselves');

-- While the CEO views Maker1, the request's claims are Maker1's with `view_as_by` the CEO: the panel still answers for the CEO.
select set_config('request.jwt.claims',
  ((select jwt from test_claims where id = '00000000-0000-0000-0000-00000000c093')::jsonb
     || jsonb_build_object('view_as_by', '00000000-0000-0000-0000-00000000c090'))::text, true);
select is(public.view_as_options() -> 'allowed', 'true'::jsonb, 'options: while viewing, the panel answers for the real person');

reset role;
select * from finish();
rollback;
