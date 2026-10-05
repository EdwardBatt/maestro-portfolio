-- ADR-0011: resources gain a unique-per-tenant NICKNAME; display name is no
-- longer unique (people share names). Nickname is the unambiguous handle and is
-- auto-generated at invite. These assertions pin the schema contract: name
-- collisions allowed, nickname collisions blocked (tenant-scoped), null/blank
-- handling, and the old/new constraints swapped. Runs as superuser — the rules
-- are table constraints, not RLS, so no role switch is needed.
begin;
select plan(7);
\ir helpers/seed.sql

-- 1. Two resources may now share a display name within one tenant.
select lives_ok($$
  insert into resources (tenant_id, kind, name, capacity_model, nickname) values
    ('aaaaaaaa-0000-0000-0000-000000000001','equipment','Shared Name','exclusive','Turbo Koshari'),
    ('aaaaaaaa-0000-0000-0000-000000000001','equipment','Shared Name','exclusive','Golden Gazelle')
$$, 'ADR-0011: display name is no longer unique per tenant');

-- 2. Nickname must be unique within a tenant (the disambiguation guarantee).
select throws_ok($$
  insert into resources (tenant_id, kind, name, capacity_model, nickname) values
    ('aaaaaaaa-0000-0000-0000-000000000001','equipment','Another','exclusive','Turbo Koshari')
$$, '23505', NULL, 'duplicate nickname in a tenant is rejected (unique index)');

-- 3. The same nickname is fine in a DIFFERENT tenant (uniqueness is scoped).
select lives_ok($$
  insert into resources (tenant_id, kind, name, capacity_model, nickname) values
    ('bbbbbbbb-0000-0000-0000-000000000001','equipment','B Thing','exclusive','Turbo Koshari')
$$, 'nickname uniqueness is tenant-scoped, not global');

-- 4. Many NULL nicknames coexist (equipment / rooms need no handle).
select lives_ok($$
  insert into resources (tenant_id, kind, name, capacity_model) values
    ('aaaaaaaa-0000-0000-0000-000000000001','room','Room 1','exclusive'),
    ('aaaaaaaa-0000-0000-0000-000000000001','room','Room 2','exclusive')
$$, 'multiple NULL nicknames are allowed (partial unique index)');

-- 5. A blank/whitespace nickname is not a handle — rejected by the check.
select throws_ok($$
  insert into resources (tenant_id, kind, name, capacity_model, nickname) values
    ('aaaaaaaa-0000-0000-0000-000000000001','equipment','Blank','exclusive','   ')
$$, '23514', NULL, 'blank nickname rejected by chk_resources_nickname_nonblank');

-- 6. The old per-tenant name-unique constraint is gone.
select is(
  (select count(*)::int from pg_constraint where conname = 'uq_resources_tenant_name'),
  0, 'uq_resources_tenant_name has been dropped');

-- 7. The new per-tenant nickname unique index exists.
select is(
  (select count(*)::int from pg_indexes where indexname = 'uq_resources_tenant_nickname'),
  1, 'uq_resources_tenant_nickname unique index exists');

select * from finish();
rollback;
