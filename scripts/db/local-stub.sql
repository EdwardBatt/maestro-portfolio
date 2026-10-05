-- LOCAL/CI HARNESS ONLY — never applied to a Supabase project.
-- Recreates the minimal Supabase surface our migrations rely on (roles,
-- auth schema, auth.uid()/auth.jwt()), so migrations + pgTAP run against
-- a plain Postgres. On real Supabase all of this already exists.

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Minimal auth.users (exists on Supabase)
create table if not exists auth.users (
  id uuid primary key,
  email text
);
-- The two columns Supabase keeps a person's claims in (ADR-0120 reads them to view as that person).
alter table auth.users add column if not exists raw_app_meta_data jsonb;
alter table auth.users add column if not exists raw_user_meta_data jsonb;

-- JWT claim readers (Supabase-compatible): claims are injected per-session via
--   select set_config('request.jwt.claims', '{"sub":"...","app_metadata":{...}}', true);
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema auth grant execute on functions to anon, authenticated, service_role;
