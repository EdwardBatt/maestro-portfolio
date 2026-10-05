-- M1.1 foundations: extensions + the app schema every later migration relies on.
-- Tenant identity comes from JWT claims ONLY (app_metadata.tenant_id) — never
-- from client-supplied parameters (AGENTS.md §6).

create extension if not exists btree_gist;

create schema if not exists app;
grant usage on schema app to anon, authenticated, service_role;

-- Tenant of the calling user, from the JWT. Set into app_metadata at
-- invite/provision time (server-side only — users cannot change app_metadata).
create or replace function app.current_tenant_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

-- Application role claim (creative / booker / team_lead / support / admin / client_portal).
create or replace function app.jwt_role() returns text
language sql stable as $$
  select auth.jwt() -> 'app_metadata' ->> 'app_role'
$$;

create or replace function app.is_admin() returns boolean
language sql stable as $$
  select app.jwt_role() = 'admin'
$$;

-- updated_at maintenance
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
