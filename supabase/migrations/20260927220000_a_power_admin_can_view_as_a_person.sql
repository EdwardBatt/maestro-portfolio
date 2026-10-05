-- ADR-0120 (Edward, 27 Sep; accepted the same day) — I59.64. A Power Admin can view Maestro as a named
-- person, read-only, on live data.
--
-- The database knows who is asking only from the request's claims (`auth.uid()` / `auth.jwt()` read
-- `request.jwt.claims`). So "view as" is decided here, per request, and not in the browser:
--
-- 1) `public.view_as_pre_request()` — PostgREST's pre-request hook (`pgrst.db_pre_request`), run before
--    every API request. With no `x-maestro-view-as` header it returns at once. With one, it refuses
--    (42501) unless the REAL caller is an active Power Admin and the person is active in the same
--    tenant; then it makes the transaction READ-ONLY, so any write fails in the database whatever the
--    screen allows, and swaps the claims for the person's own (`auth.users.raw_app_meta_data`, as their
--    real sign-in would carry), so RLS, every function and every "me" query answer as for them.
-- 2) `public.view_as_start(p_user)` — called once when a view starts (without the header): the same
--    checks, one `audit_events` row (`view_as`), and the person's identity back for the screen. The person
--    is not notified (ADR-0120, Edward: A).
-- 3) The hook is registered on the `authenticator` role and PostgREST told to reload. Guarded, because
--    the throwaway database `scripts/db/verify.sh` builds has no PostgREST roles.

begin;

-- ============================================================================
-- the checks both entry points share
-- ============================================================================
create or replace function app.view_as_target(p_real uuid, p_user uuid)
returns auth.users
language plpgsql stable security definer
set search_path = public, app, extensions
as $$
declare
  v_real   user_profiles;
  v_target user_profiles;
  v_user   auth.users;
begin
  select * into v_real from user_profiles where id = p_real;
  if v_real.id is null or not v_real.is_active
     or not exists (select 1 from roles r where r.id = v_real.role_id and r.key = 'power_admin') then
    raise exception 'only a Power Admin may view as another person' using errcode = '42501';
  end if;
  select * into v_target from user_profiles where id = p_user;
  if v_target.id is null or not v_target.is_active or v_target.tenant_id <> v_real.tenant_id then
    raise exception 'that person cannot be viewed' using errcode = '42501';
  end if;
  select * into v_user from auth.users where id = p_user;
  if v_user.id is null then
    raise exception 'that person cannot be viewed' using errcode = '42501';
  end if;
  return v_user;
end $$;

revoke all on function app.view_as_target(uuid, uuid) from public;

-- ============================================================================
-- 1) the pre-request hook
-- ============================================================================
create or replace function public.view_as_pre_request()
returns void
language plpgsql security definer
set search_path = public, app, extensions
as $$
declare
  v_header text := nullif(current_setting('request.headers', true), '')::json ->> 'x-maestro-view-as';
  v_claims jsonb;
  v_user   auth.users;
begin
  if v_header is null or v_header = '' then
    return;
  end if;
  if v_header !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'that person cannot be viewed' using errcode = '42501';
  end if;
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null or v_claims ->> 'sub' is null then
    raise exception 'only a Power Admin may view as another person' using errcode = '42501';
  end if;

  v_user := app.view_as_target((v_claims ->> 'sub')::uuid, v_header::uuid);

  -- Read-only first: from here on nothing in this request can write.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('request.jwt.claims',
    (v_claims || jsonb_build_object(
       'sub', v_user.id::text,
       'email', v_user.email,
       'app_metadata', coalesce(v_user.raw_app_meta_data, '{}'::jsonb),
       'user_metadata', coalesce(v_user.raw_user_meta_data, '{}'::jsonb),
       'view_as_by', v_claims ->> 'sub'))::text,
    true);
  perform set_config('request.jwt.claim.sub', v_user.id::text, true);
end $$;

comment on function public.view_as_pre_request() is
  'ADR-0120: PostgREST pre-request hook. With x-maestro-view-as and a Power Admin caller, the request runs '
  'read-only as that person (same tenant, active). Without the header it does nothing.';

grant execute on function public.view_as_pre_request() to anon, authenticated;

-- ============================================================================
-- 2) starting a view: checked, recorded, and the person's identity for the screen
-- ============================================================================
create or replace function public.view_as_start(p_user uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions
as $$
declare
  v_user    auth.users;
  v_profile user_profiles;
begin
  v_user := app.view_as_target(auth.uid(), p_user);
  select * into v_profile from user_profiles where id = p_user;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v_profile.tenant_id, auth.uid(), 'view_as', 'user_profiles', p_user,
          jsonb_build_object('viewed', v_profile.display_name, 'read_only', true));

  return jsonb_build_object(
    'id', v_user.id,
    'email', v_user.email,
    'name', v_profile.display_name,
    'app_metadata', coalesce(v_user.raw_app_meta_data, '{}'::jsonb));
end $$;

comment on function public.view_as_start(uuid) is
  'ADR-0120: a Power Admin starts viewing as a person. Checks the same rules as the pre-request hook, '
  'records the view in audit_events, and returns the person''s identity (id, email, name, app_metadata).';

revoke all on function public.view_as_start(uuid) from public;
grant execute on function public.view_as_start(uuid) to authenticated;

-- ============================================================================
-- 3) register the hook
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    execute 'alter role authenticator set pgrst.db_pre_request = ''public.view_as_pre_request''';
    perform pg_notify('pgrst', 'reload config');
  end if;
end $$;

commit;
