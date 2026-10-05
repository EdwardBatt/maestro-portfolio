-- L6.3 (ADR-0036): adversarial pgTAP for the per-user RBAC overlay.
--
-- Proves both axes of the overlay and every guardrail:
--   permission axis  app.has_permission = (role OR user-allow) AND NOT user-deny (deny wins)
--   scope axis       app.in_write_scope gains additive per-user department/team targets
--   guardrails       no self-grant · non-admin can't grant · cross-tenant target/dept denied ·
--                    client_portal fenced · RBAC-admin grants un-deny-able · one-effect-per-triple ·
--                    one-target-per-scope-row · revocation is immediate · reads don't cross tenants
--
-- Subjects (from helpers/seed.sql, tenant A): a001 = power_admin (holds user_grants:manage via the
-- full-catalog seed), a003 = team_member (role scope 'self'; media:manage from its role, project_tasks:manage from the seed fixture).
-- b001/b002 live in tenant B. Overlay rows are ALWAYS inserted via the authenticated admin path —
-- app.tg_stamp_granted_by forces granted_by = auth.uid(), so a superuser insert (auth.uid() null)
-- would violate NOT NULL. That path-through is itself part of what we assert.
--
-- Note: sub_tasks write-scope was NOT relaxed by the TEMP alpha toggles (only booking writes were),
-- so the end-to-end scope-elevation assertions exercise the real in_write_scope gate.

begin;
select plan(37);
\ir helpers/seed.sql

-- ---- extra fixtures on tenants A & B (superuser; RLS off here) ----
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-0000000000e9', 'portal-a@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id)
  values ('aaaaaaaa-0000-0000-0000-0000000000e9', 'aaaaaaaa-0000-0000-0000-000000000001', 'Portal A',
          (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and key = 'client_portal'));

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production'),
  ('bbbbbbbb-0000-0000-0000-0000000000d1', 'bbbbbbbb-0000-0000-0000-000000000001', 'B Dept');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000001a', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'Art&Video'),
  ('aaaaaaaa-0000-0000-0000-00000000001b', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d1', 'CopySocial'),
  ('aaaaaaaa-0000-0000-0000-00000000002c', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000d2', 'PostProd');

set local role authenticated;

-- =====================================================================
-- Permission axis
-- =====================================================================

-- 1) baseline: team_member does not hold audit:view (not in role, not TEMP-alpha-granted).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.has_permission('audit', 'view'), false, 'baseline: team member lacks audit:view');

-- 2) a power admin can add it as a per-user allow-grant.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'audit', 'view', 'allow')$$,
  'power admin grants a per-user allow');

-- 3) the allow-grant adds exactly that ability.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.has_permission('audit', 'view'), true, 'allow-grant adds the ability');

-- 4) baseline: team member DOES hold media:manage from its role.
select is(app.has_permission('media', 'manage'), true, 'baseline: team member holds media:manage (role)');

-- 5) a power admin denies it for this one user.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'media', 'manage', 'deny')$$,
  'power admin adds a per-user deny');

-- 6) deny wins over the role grant.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.has_permission('media', 'manage'), false, 'deny takes precedence over the role grant');

-- 7) no self-grant, even for a power admin (segregation of duties).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'audit', 'view', 'allow')$$,
  '42501', null, 'no self-grant (target = caller denied)');

-- 8) a non-admin cannot grant.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a002', 'audit', 'view', 'allow')$$,
  '42501', null, 'non-admin cannot grant (lacks user_grants:manage)');

-- 9) cross-tenant target denied.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b002', 'audit', 'view', 'allow')$$,
  '42501', null, 'cannot grant to a user in another tenant');

-- 10) client_portal target fenced.
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000000e9', 'audit', 'view', 'allow')$$,
  '42501', null, 'client_portal identity cannot receive an overlay grant');

-- 11) RBAC-admin grants can never be denied (would risk bricking the tenant).
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'user_grants', 'manage', 'deny')$$,
  '23514', null, 'cannot deny user_grants:manage (self-lockout fence)');

-- 12) …same for roles:manage.
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'roles', 'manage', 'deny')$$,
  '23514', null, 'cannot deny roles:manage (self-lockout fence)');

-- 13) one effect per triple: a deny on the same (user,resource,action) as the existing allow collides.
select throws_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'audit', 'view', 'deny')$$,
  '23505', null, 'a triple holds one effect (allow already present → PK collision)');

-- 14) set up a tenant-B grant (via B's own admin) for the isolation check.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select lives_ok(
  $$insert into user_grants (tenant_id, user_id, resource, action, effect)
    values ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b002', 'audit', 'view', 'allow')$$,
  'tenant B admin grants within tenant B');

-- 15) tenant A user cannot read tenant B's grants.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is((select count(*)::int from user_grants where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001'), 0,
  'grants do not leak across tenants (read)');

-- 16) revocation: the admin removes the allow-grant…
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$delete from user_grants
    where user_id = '00000000-0000-0000-0000-00000000a003' and resource = 'audit' and action = 'view'$$,
  'power admin revokes the allow-grant');

-- 17) …and the ability is gone immediately.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.has_permission('audit', 'view'), false, 'revocation is immediate');

-- =====================================================================
-- Scope axis
-- =====================================================================

-- 18) baseline: a 'self'-scoped user has no write reach over a team.
select is(app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a', null), false,
  'baseline: self-scope has no reach over a team');

-- 19) admin grants a TEAM scope target.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$insert into user_scope_grants (tenant_id, user_id, team_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'aaaaaaaa-0000-0000-0000-00000000001a')$$,
  'power admin grants a team scope target');

-- 20) the granted team is now in write scope.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a', null), true,
  'team scope-grant elevates reach to exactly that team');

-- 21) it does NOT leak to a sibling team.
select is(app.in_write_scope(null, 'aaaaaaaa-0000-0000-0000-00000000001b', null), false,
  'team scope-grant does not reach a sibling team');

-- 22) admin grants a DEPARTMENT scope target.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$insert into user_scope_grants (tenant_id, user_id, department_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'aaaaaaaa-0000-0000-0000-0000000000d1')$$,
  'power admin grants a department scope target');

-- 23) a granted department covers its teams (ADR-0014 parity).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.in_write_scope(null, 'aaaaaaaa-0000-0000-0000-00000000001b', null), true,
  'department scope-grant covers a team in that department');

-- 24) it does NOT leak to another department's team.
select is(app.in_write_scope('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-00000000002c', null), false,
  'department scope-grant does not reach another department');

-- 25) no self scope-grant.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$insert into user_scope_grants (tenant_id, user_id, team_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001', 'aaaaaaaa-0000-0000-0000-00000000001a')$$,
  '42501', null, 'no self scope-grant');

-- 26) exactly one target per row: both-null rejected.
select throws_ok(
  $$insert into user_scope_grants (tenant_id, user_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003')$$,
  '23514', null, 'scope grant requires exactly one target (both null rejected)');

-- 27) …both-set rejected.
select throws_ok(
  $$insert into user_scope_grants (tenant_id, user_id, department_id, team_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
            'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a')$$,
  '23514', null, 'scope grant requires exactly one target (both set rejected)');

-- 28) cannot grant scope over another tenant's department.
select throws_ok(
  $$insert into user_scope_grants (tenant_id, user_id, department_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
            'bbbbbbbb-0000-0000-0000-0000000000d1')$$,
  '42501', null, 'cannot grant a scope target in another tenant');

-- 29) end-to-end: the scope-granted user can now assign a sub-task in the granted team
--     (holds project_tasks:manage from the seed fixture; in_write_scope now passes via the overlay).
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select lives_ok(
  $$insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101',
            'aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-00000000001a', 'overlay-in-scope')$$,
  'scope-granted user assigns a sub-task in the granted team (policy consumes in_write_scope)');

-- 30) …but still cannot in an un-granted department.
select throws_ok(
  $$insert into sub_tasks (tenant_id, deliverable_id, department_id, team_id, title)
    values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101',
            'aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-00000000002c', 'overlay-out-of-scope')$$,
  '42501', null, 'scope-granted user still denied outside every granted target');

-- =====================================================================
-- Secondary invariants (review coverage)
-- =====================================================================

-- 31) deny is scoped to exactly one triple: media:manage was denied (assertion 6), but the
--     user's other role ability is untouched.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select is(app.has_permission('project_tasks', 'manage'), true, 'deny is scoped to one triple (project_tasks:manage intact)');

-- 32) L6.11 (ADR-0037 d.4): the grant TABLES are private now — an ordinary user reads none of them,
--     not even their own rows. What they get instead is public.my_permissions(), which returns the
--     EFFECTIVE set. One allow was revoked and media:manage is denied, so media:manage is absent.
select is((select count(*)::int from user_grants where user_id = '00000000-0000-0000-0000-00000000a003'), 0,
  'a user cannot read the grant table itself — not even their own rows');
select ok(
  not exists (select 1 from public.my_permissions() where resource = 'media' and action = 'manage'),
  'but my_permissions() gives them their own effective set, with the deny applied');

-- 33) …and the same for scope targets: the table is private, the self-scoped RPC is not.
select is((select count(*)::int from user_scope_grants where user_id = '00000000-0000-0000-0000-00000000a003'), 0,
  'a user cannot read user_scope_grants directly either');
select is((select count(*)::int from public.my_scope_grants()), 2,
  'my_scope_grants() returns their own two targets (team 1a + department d1)');

-- 34) scope targets are unique per (user, target): a duplicate team grant collides.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$insert into user_scope_grants (tenant_id, user_id, team_id)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003', 'aaaaaaaa-0000-0000-0000-00000000001a')$$,
  '23505', null, 'duplicate scope target rejected (partial unique index)');

-- 35) a non-admin cannot delete a grant: the RLS USING clause filters the row out, so the delete
--     is a silent no-op (not an error) — the grant survives.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
delete from user_grants where user_id = '00000000-0000-0000-0000-00000000a003' and resource = 'media' and action = 'manage';
set local role postgres;   -- verify as someone who can actually see the table
select is((select count(*)::int from user_grants where user_id = '00000000-0000-0000-0000-00000000a003' and resource = 'media'), 1,
  'non-admin delete is a no-op (grant survives)');
set local role authenticated;

reset role;
select * from finish();
rollback;
