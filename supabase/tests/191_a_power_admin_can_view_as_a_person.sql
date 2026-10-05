-- 20260927220000 (ADR-0120, I59.64) — a Power Admin can view Maestro as a named person, read-only.
--
-- `public.view_as_pre_request()` is PostgREST's pre-request hook. It is called here as PostgREST calls it:
-- as `authenticated`, with the real caller's claims in `request.jwt.claims` and the request's headers in
-- `request.headers`. Each attempt runs inside `pg_temp.try_view_as`, whose inner block records what the
-- request would see and then rolls itself back, so the read-only switch cannot leak into the next test.
-- People: a001 Power Admin (tenant A), a003 a team member (tenant A), b001 Power Admin (tenant B).
begin;
select plan(12);
\ir helpers/seed.sql

insert into auth.users (id, email, raw_app_meta_data) values
  ('00000000-0000-0000-0000-00000000a191', 'gone-191@a.test', '{"tenant_id":"aaaaaaaa-0000-0000-0000-000000000001"}');
insert into user_profiles (id, tenant_id, display_name, role_id, is_active)
values ('00000000-0000-0000-0000-00000000a191', 'aaaaaaaa-0000-0000-0000-000000000001', 'Gone 191',
        (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'team_member'), false);
update auth.users set raw_app_meta_data = jsonb_build_object('tenant_id', 'aaaaaaaa-0000-0000-0000-000000000001', 'team_id', 'marker-191')
 where id = '00000000-0000-0000-0000-00000000a003';

create function pg_temp.try_view_as(p_caller uuid, p_header text,
  out uid uuid, out read_only text, out team text, out by_whom text, out write_state text, out err_state text)
language plpgsql as $$
begin
  begin
    perform set_config('request.jwt.claims', (select jwt from test_claims where id = p_caller), true);
    perform set_config('request.headers',
      case when p_header is null then '{}' else json_build_object('x-maestro-view-as', p_header)::text end, true);
    perform public.view_as_pre_request();
    uid := auth.uid();
    read_only := current_setting('transaction_read_only');
    team := auth.jwt() -> 'app_metadata' ->> 'team_id';
    by_whom := auth.jwt() ->> 'view_as_by';
    begin
      update user_profiles set job_title = 'written while viewing' where id = auth.uid();
      write_state := 'written';
    exception when others then
      write_state := sqlstate;
    end;
    raise exception 'undo' using errcode = 'P0001';
  exception
    when sqlstate 'P0001' then null;
    when others then err_state := sqlstate;
  end;
end $$;
grant execute on function pg_temp.try_view_as(uuid, text) to authenticated;

set local role authenticated;

-- ---------------------------------------------------------------- no header: nothing changes ----
select is((select uid from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', null)),
          '00000000-0000-0000-0000-00000000a001'::uuid,
  'without the header the request is the caller''s own');
select is((select read_only from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', null)), 'off',
  'and it is not made read-only');

-- ---------------------------------------------------------------- a Power Admin viewing a003 ----
select is((select uid from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003')),
          '00000000-0000-0000-0000-00000000a003'::uuid,
  'a Power Admin with the header is answered as that person (d.1)');
select is((select team from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003')),
          'marker-191',
  'with the person''s own app_metadata, as their sign-in carries it');
select is((select by_whom from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003')),
          '00000000-0000-0000-0000-00000000a001',
  'and the claims say who is really looking');
select is((select read_only from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003')), 'on',
  'the request is read-only');
select is((select write_state from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a003')), '25006',
  'so a write is refused by the database itself, whatever the screen allows');

-- ---------------------------------------------------------------- refusals ----
select is((select err_state from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001')), '42501',
  'a person who is not a Power Admin is refused');
select is((select err_state from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000b001')), '42501',
  'nobody in another tenant can be viewed');
select is((select err_state from pg_temp.try_view_as('00000000-0000-0000-0000-00000000a001', '00000000-0000-0000-0000-00000000a191')), '42501',
  'nor an inactive person');

-- ---------------------------------------------------------------- starting a view is recorded ----
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is((select public.view_as_start('00000000-0000-0000-0000-00000000a003') ->> 'name'), 'Creative A',
  'view_as_start answers with the person (d.2)');
reset role;
select is((select count(*)::int from audit_events
            where action = 'view_as' and actor_user_id = '00000000-0000-0000-0000-00000000a001'
              and entity_id = '00000000-0000-0000-0000-00000000a003'), 1,
  'and records the view in the audit log, the admin as actor (d.2)');

select * from finish();
rollback;
