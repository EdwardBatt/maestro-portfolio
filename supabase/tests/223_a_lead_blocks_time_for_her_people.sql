-- I74 fix-up (Edward, 3 Oct, Q13) — a lead blocks time for the people she leads, leave included, from the Schedule's
-- Block time, without leave:manage; the leave lands as the row the Leave page reads.
--
-- Fixtures (tenant A): Production with two teams — Studio (a team lead, a maker) and Edit (a maker); a department lead.
--   a231 Studio TL 223   team_lead, Production / Studio — holds bookings:create, NOT leave:manage nor blackouts:manage
--   a232 Studio Maker    team_member, Production / Studio (resource)
--   a233 Edit Maker      team_member, Production / Edit (resource)
--   a234 Production DL   department_lead, Production
-- (maestro-rls-testing: allow and deny for the new policy; tenant isolation is the existing tenant_id arm.)
begin;
select plan(10);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a231', 'studio-tl223@a.test'),
  ('00000000-0000-0000-0000-00000000a232', 'studio-maker223@a.test'),
  ('00000000-0000-0000-0000-00000000a233', 'edit-maker223@a.test'),
  ('00000000-0000-0000-0000-00000000a234', 'production-dl223@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de23', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production 223');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000e2231', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de23', 'Studio 223'),
  ('aaaaaaaa-0000-0000-0000-0000000e2232', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000de23', 'Edit 223');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a231','Studio TL 223',    'team_lead',      'aaaaaaaa-0000-0000-0000-00000000de23','aaaaaaaa-0000-0000-0000-0000000e2231'),
  ('00000000-0000-0000-0000-00000000a232','Studio Maker 223', 'team_member',    'aaaaaaaa-0000-0000-0000-00000000de23','aaaaaaaa-0000-0000-0000-0000000e2231'),
  ('00000000-0000-0000-0000-00000000a233','Edit Maker 223',   'team_member',    'aaaaaaaa-0000-0000-0000-00000000de23','aaaaaaaa-0000-0000-0000-0000000e2232'),
  ('00000000-0000-0000-0000-00000000a234','Production DL 223','department_lead','aaaaaaaa-0000-0000-0000-00000000de23', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000a23%';

insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2232','aaaaaaaa-0000-0000-0000-000000000001','human','Studio Maker 223','load_based',120.0,100.0,
   '00000000-0000-0000-0000-00000000a232','aaaaaaaa-0000-0000-0000-00000000de23','aaaaaaaa-0000-0000-0000-0000000e2231'),
  ('aaaaaaaa-0000-0000-0000-0000000d2233','aaaaaaaa-0000-0000-0000-000000000001','human','Edit Maker 223','load_based',120.0,100.0,
   '00000000-0000-0000-0000-00000000a233','aaaaaaaa-0000-0000-0000-00000000de23','aaaaaaaa-0000-0000-0000-0000000e2232');

-- The fixture's premise: the team lead holds no leave grant and no blackout grant.
select ok(not app.user_holds_permission('00000000-0000-0000-0000-00000000a231', 'leave', 'manage')
          and not app.user_holds_permission('00000000-0000-0000-0000-00000000a231', 'blackouts', 'manage'),
  'the team lead holds neither leave:manage nor blackouts:manage');

-- ======================================================= the team lead, her own team ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a231'),true);
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2232','leave','planned',
          '2026-11-01T00:00:00Z','2026-11-02T23:59:59Z') $$,
  'a team lead blocks leave for her own team member — without leave:manage');
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at, hours, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2232','internal',
          '2026-11-03T00:00:00Z','2026-11-03T23:59:59Z', 2, 'Studio clean-up') $$,
  'and internal work for her');
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2233','leave','planned',
          '2026-11-01T00:00:00Z','2026-11-01T23:59:59Z') $$,
  '42501', null, 'another team''s person is refused — inside her department but not her team');
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2232','maintenance',
          '2026-11-04T00:00:00Z','2026-11-04T23:59:59Z') $$,
  '42501', null, 'only leave and internal work — not maintenance, which stays with blackouts:manage');

-- ======================================================= the department lead, his department ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a234'),true);
select lives_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2233','leave','planned',
          '2026-11-05T00:00:00Z','2026-11-05T23:59:59Z') $$,
  'a department lead blocks leave for anyone in his department');

-- ======================================================= a team member ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a232'),true);
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, category, starts_at, ends_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2232','leave','planned',
          '2026-11-06T00:00:00Z','2026-11-06T23:59:59Z') $$,
  '42501', null, 'a team member is refused — even for herself');
select throws_ok($$
  insert into resource_unavailability (tenant_id, resource_id, kind, starts_at, ends_at, hours, reason)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d2233','internal',
          '2026-11-06T00:00:00Z','2026-11-06T23:59:59Z', 1, 'x') $$,
  '42501', null, 'and for a colleague');

-- ======================================================= the Leave page reads the same row ====
reset role;
select is((select count(*)::int from resource_unavailability
            where resource_id = 'aaaaaaaa-0000-0000-0000-0000000d2232' and kind in ('leave', 'holiday')), 1,
  'the leave the team lead blocked is a kind=leave row — what the Leave page lists');
select is((select count(*)::int from resource_unavailability
            where resource_id = 'aaaaaaaa-0000-0000-0000-0000000d2232' and kind = 'internal' and hours = 2), 1,
  'the internal work counts its hours');

select * from finish();
rollback;
