-- ADR-0083 d.9 / I44.8 — a campaign deliverable is owned by a lead, and a lead hands it on within
-- their department (11 Sep, Edward's option A: enforced everywhere, campaigns included).
--
-- Four properties:
--   * a TEAM MEMBER cannot be made the owner — not by a department lead through the RPC, not by
--     Traffic by bare update, and not on insert by the wizard's path (an insert as authenticated);
--   * a department lead reassigns to a TEAM LEAD in their own department (the ADR's sentence) and
--     is refused a lead in another department;
--   * a tenant-scoped actor (Traffic) and the campaign's ACCOUNT MANAGER may hand it to another
--     department's lead — they are the people who could have placed it there — and the deliverable
--     STAYS in its own department while they do (ADR-0099 d.2, superseding ADR-0050 d.2);
--   * job work with no stream (ad-hoc, internal projects) is untouched: an ad-hoc deliverable's
--     owner is its assignee by design (20260829090000).
--
-- The rule reads roles.scope, never a role name. Runs as `authenticated` with each caller's own
-- claims; a superuser run proves nothing because the trigger escapes for auth.uid() null.

begin;
select plan(16);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- fixtures ----
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a020', 'creative-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a021', 'copy-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a022', 'copy-maker@a.test'),
  ('00000000-0000-0000-0000-00000000a023', 'production-lead@a.test'),
  ('00000000-0000-0000-0000-00000000a024', 'account-mgr@a.test');

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-000000000001','Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002','aaaaaaaa-0000-0000-0000-000000000001','Production');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000de001','Copy');

insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a020','Creative Lead',   'department_lead','aaaaaaaa-0000-0000-0000-0000000de001', null),
  ('00000000-0000-0000-0000-00000000a021','Copy Lead',       'team_lead',      'aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a022','Copy Maker',      'team_member',    'aaaaaaaa-0000-0000-0000-0000000de001','aaaaaaaa-0000-0000-0000-00000000f001'),
  ('00000000-0000-0000-0000-00000000a023','Production Lead', 'department_lead','aaaaaaaa-0000-0000-0000-0000000de002', null),
  ('00000000-0000-0000-0000-00000000a024','Account Mgr',     'account_manager', null, null)
) as v(id, name, role_key, dept, team);

insert into test_claims
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a020','00000000-0000-0000-0000-00000000a021',
                 '00000000-0000-0000-0000-00000000a022','00000000-0000-0000-0000-00000000a023',
                 '00000000-0000-0000-0000-00000000a024');

-- The seed's approved campaign, with a024 as its account manager; a Creative deliverable owned by
-- the Creative lead (inserted as superuser — the fixture escape, like every seeder).
update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a024'
 where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000107f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S107');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000107e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000107f1','Key visual 107','in_progress',
   '00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a020');
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'),
  'aaaaaaaa-0000-0000-0000-0000000de001'::uuid,
  'fixture: the deliverable sits in Creative, defaulted from its owner at creation (ADR-0099 d.2)');

-- ============================================ 1. a team member is never the owner ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select throws_ok($$
  select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000107e1', '00000000-0000-0000-0000-00000000a022')
$$, '42501', null, 'the department lead cannot hand a deliverable to a team member (d.9)');

-- Traffic holds tenant scope and every grant — and is refused on the same ground, by bare update.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$
  update deliverables set owner_user_id = '00000000-0000-0000-0000-00000000a022'
   where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'
$$, '42501', null, '… nor can Traffic, by bare update — the rule is about the OWNER, not the caller');

-- On insert too: the wizard writes deliverables as the account manager.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a024'),true);
select throws_ok($$
  insert into deliverables (tenant_id, stream_id, name, state, reviewer_id, owner_user_id, due_at) values
    ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000107f1','Second 107',
     'in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a022','2026-10-01 15:00+00')
$$, '42501', null, '… nor can the account manager name a team member as owner when the deliverable is created');
select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'),
  '00000000-0000-0000-0000-00000000a020'::uuid, 'nothing moved');

-- ============================================ 2. a lead hands on within the department ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a020'),true);
select lives_ok($$
  select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000107e1', '00000000-0000-0000-0000-00000000a021')
$$, 'the department lead hands it to one of their team leads (d.9)');
select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'),
  '00000000-0000-0000-0000-00000000a021'::uuid, '… and the Copy lead now owns it');
select throws_ok($$
  select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000107e1', '00000000-0000-0000-0000-00000000a023')
$$, '42501', null, 'but not to a lead in ANOTHER department — that is not theirs to move');

-- ================================== 3. the account manager and Traffic may move it ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a024'),true);
select lives_ok($$
  select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000107e1', '00000000-0000-0000-0000-00000000a023')
$$, 'the campaign''s account manager moves it to Production''s lead');
-- ADR-0102 (24 Sep): the department follows the owner again — handing it to Production's lead
-- makes it Production's work.
select is(
  (select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'),
  (select department_id from user_profiles where id = '00000000-0000-0000-0000-00000000a023'),
  '… and the work follows its owner into their department (ADR-0102 d.1)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000107e1', '00000000-0000-0000-0000-00000000a020')
$$, 'and Traffic moves it back to Creative''s lead — tenant reach');

-- ============================================== 4. job work with no stream is untouched ====
-- An ad-hoc deliverable's owner is its assignee by design; a team member (the seed's a003, who
-- has a calendar) is exactly who that is.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$
  select public.create_adhoc_deliverable('00000000-0000-0000-0000-00000000a003', 'Ad-hoc 107', 2,
    '2027-03-01T09:00:00Z', '2027-03-01T17:00:00Z', '00000000-0000-0000-0000-00000000a001')
$$, 'an ad-hoc deliverable is still owned by the team member it is assigned to (no stream — outside d.9)');
select is(
  (select owner_user_id from deliverables where name = 'Ad-hoc 107'),
  '00000000-0000-0000-0000-00000000a003'::uuid, '… and the owner is the assignee, as 20260829090000 wrote it');

-- ============================================== 5. a campaign deliverable keeps its owner (d.11) ====
-- 107e1 is owned by Creative's lead (a020) again. Traffic holds tenant reach and every grant — and
-- still cannot clear the owner to nobody on stream work.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select throws_ok($$
  update deliverables set owner_user_id = null
   where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'
$$, '42501', 'a campaign deliverable keeps an owner — reassign it to a lead, it cannot be set to nobody',
  'an owner that is already set cannot be cleared to nobody (d.11) — not even by Traffic');
select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000107e1'),
  '00000000-0000-0000-0000-00000000a020'::uuid, '… the owner stands');

-- Born-null is no longer allowed. ADR-0083 d.11 let a deliverable be created before its department
-- had a lead; ADR-0100 d.8 closes that, because the owner is now who approves the task list before
-- anyone can be assigned (d.2) — so a deliverable with nobody answering for it is work that can
-- never be started, and nothing in the database used to stop one being made. Decided in I22.5 on
-- 28 Aug and enforced by the wizard alone until 23 Sep. Fixtures with no JWT still escape the
-- guard, which is why every insert above this line is legal; a real caller is refused.
select throws_ok($$
  insert into deliverables (tenant_id, stream_id, name, state, reviewer_id, owner_user_id, due_at) values
    ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000107f1','Born ownerless 107',
     'in_progress','00000000-0000-0000-0000-00000000a001', null,'2026-10-01 15:00+00')
$$, '23502',
  'This deliverable needs an owner: somebody has to answer for it, and they are who approves its task list before anyone can be assigned.',
  'a campaign deliverable can no longer be BORN without an owner (ADR-0100 d.8)');

select * from finish();
rollback;
