-- ADR-0029 (I7.2b): per-project PM booking authority.
-- A Team Leader appointed as a project's PM (job.owner_user_id) may book a resource in ANOTHER team
-- (outside their normal write-scope) for THEIR project's deliverable — but not for a project they
-- don't own.
begin;
select plan(3);
\ir helpers/seed.sql

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a057', 'pm57@a.test');
insert into departments (id, tenant_id, name) values ('aaaaaaaa-0000-0000-0000-0000000057d1','aaaaaaaa-0000-0000-0000-000000000001','Dept57');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000057a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057d1','TeamA57'),
  ('aaaaaaaa-0000-0000-0000-0000000057b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057d1','TeamB57');
-- the PM is a Team Leader in TeamA57
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select '00000000-0000-0000-0000-00000000a057','aaaaaaaa-0000-0000-0000-000000000001','PM57',
  (select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key='team_lead'),
  'aaaaaaaa-0000-0000-0000-0000000057d1','aaaaaaaa-0000-0000-0000-0000000057a1';
-- a resource that lives in TeamB57 (OUTSIDE the PM's team scope)
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000057f1','aaaaaaaa-0000-0000-0000-000000000001','human','OtherTeamPerson','load_based',120,100,'aaaaaaaa-0000-0000-0000-0000000057d1','aaaaaaaa-0000-0000-0000-0000000057b1');
-- the PM's project (job owned by the PM) + a deliverable under it
insert into jobs (id, tenant_id, client_id, name, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000005701','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001','PM project','00000000-0000-0000-0000-00000000a057');
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000057e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000005701','PM deliverable', '00000000-0000-0000-0000-00000000a001');

create temp table pm_claim as
select json_build_object('sub', up.id, 'app_metadata', json_build_object(
  'tenant_id', up.tenant_id, 'app_role_id', up.role_id,
  'department_id', up.department_id, 'team_id', up.team_id))::text as jwt
from user_profiles up where up.id = '00000000-0000-0000-0000-00000000a057';
grant select on pm_claim to public;

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from pm_claim), true);

-- the resource is genuinely outside the PM's normal write-scope
select is(app.resource_in_write_scope('aaaaaaaa-0000-0000-0000-0000000057f1'), false,
  'the TeamB57 resource is outside the PM''s team write-scope');

-- ...but as PM of the project, they may book it for their deliverable
select lives_ok($$ insert into bookings (tenant_id, resource_id, deliverable_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057f1','aaaaaaaa-0000-0000-0000-0000000057e1','2027-04-01 09:00+00','2027-04-01 10:00+00',50) $$,
  'the PM books a cross-department resource for their own project');

-- ...but NOT for a deliverable outside their project: ADR-0139 d.1 (3 Oct) narrows a team-scoped role back to its own
-- team, so the bypass is again the only thing that admits a cross-scope booking, and only on the PM's own project.
select throws_ok($$ insert into bookings (tenant_id, resource_id, deliverable_id, starts_at, ends_at, load_pct) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000057f1','aaaaaaaa-0000-0000-0000-00000000f101','2027-04-01 11:00+00','2027-04-01 12:00+00',50) $$,
  '42501', null,
  'the PM is refused a cross-scope resource for a deliverable outside their project — another team is a request (ADR-0139 d.1)');

select * from finish();
rollback;
