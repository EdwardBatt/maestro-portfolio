-- 20260929150000 (I66.7) — a new tenant's roles land on My Work; the roles that hold no My Work (CEO, COO, CFO)
-- land on the Dashboard; the client portal keeps its portal. The column default is My Work.
begin;
select plan(4);
\ir helpers/seed.sql

insert into tenants (id, name, slug) values ('cccccccc-0000-0000-0000-000000000198', 'Tenant 198', 'tenant-198');
select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000198');

select is_empty($$
  select key from roles
   where tenant_id = 'cccccccc-0000-0000-0000-000000000198'
     and key not in ('ceo', 'coo', 'cfo', 'client_portal')
     and default_route <> '/my-work' $$,
  'every role that holds My Work lands on it — the Account Director too');
select results_eq($$
  select key, default_route from roles
   where tenant_id = 'cccccccc-0000-0000-0000-000000000198' and key in ('ceo', 'cfo', 'coo') order by key $$,
  $$ values ('ceo'::text, '/dashboard'::text), ('cfo', '/dashboard'), ('coo', '/dashboard') $$,
  'CEO, COO and CFO hold no My Work, so they land on the Dashboard');
select is_empty($$
  select 1 from roles r
   where r.tenant_id = 'cccccccc-0000-0000-0000-000000000198' and r.default_route = '/dashboard'
     and exists (select 1 from role_grants g where g.role_id = r.id and g.resource = 'my_tasks' and g.action = 'view') $$,
  'nobody who holds My Work is sent to the Dashboard');
select is((select column_default from information_schema.columns where table_name = 'roles' and column_name = 'default_route'),
  '''/my-work''::text', 'a role made by hand starts on My Work');

select * from finish();
rollback;
