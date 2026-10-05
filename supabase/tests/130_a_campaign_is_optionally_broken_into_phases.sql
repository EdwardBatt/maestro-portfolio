-- I53.5 / ADR-0096 (20 Sep) — a campaign is optionally broken into phases, and every deliverable
-- belongs to one.
--
--   * TOGGLE ON — MAY: the account manager. MAY NOT: a department lead, a team member (42501, worded).
--     With deliverables present, one phase ("Phase 1") is made and holds every one of them (d.5).
--   * PHASES — add at the next number, rename, re-date; a lead is refused; a phase that ends before
--     it starts is refused. Overlap is allowed (d.2).
--   * MOVE — the AM moves a deliverable; a lead is refused by the RPC AND by a direct PATCH (the
--     guard, ADR-0037); a phase of another campaign is refused (d.3).
--   * INVARIANT — a new deliverable on a phased campaign needs a phase; one on an unphased campaign
--     may not carry one; ad-hoc work never.
--   * DELETE — refused while the phase holds deliverables (counted); an empty one goes and the rest
--     renumber down (d.6).
--   * TOGGLE OFF — refused while two phases hold deliverables, worded with the counts; allowed once
--     everything sits in one; the phases go and every phase_id is cleared (d.5).
--   * A single job may never have phases (d.1). The wizard's writer takes p_phases (d.8).
--   * RLS — campaign_phases is readable tenant-wide and has NO write policy: a direct insert is
--     refused even for the AM.
begin;
select plan(35);
\ir helpers/seed.sql

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a080', 'am130@a.test'),
  ('00000000-0000-0000-0000-00000000a081', 'lead130@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1300','aaaaaaaa-0000-0000-0000-000000000001','Creative 130');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a080','AM 130',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a081','Lead 130', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1300')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id,
       json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a080','00000000-0000-0000-0000-00000000a081');

-- Two campaigns the AM manages: one to phase, one to prove a phase cannot cross over. And a single job.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, go_live_at) values
  ('aaaaaaaa-0000-0000-0000-000000001300','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 130','approved','campaign','00000000-0000-0000-0000-00000000a080', '2026-10-16 00:00+00'),
  ('aaaaaaaa-0000-0000-0000-000000001310','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Other 130','approved','campaign','00000000-0000-0000-0000-00000000a080', null),
  ('aaaaaaaa-0000-0000-0000-000000001320','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Job 130','approved','single_job','00000000-0000-0000-0000-00000000a080', null);
-- ADR-0116 d.3 (27 Sep): a campaign's pieces are added into a workstream.
insert into workstreams (tenant_id, campaign_id, name, department_id)
select tenant_id, id, 'Main work', 'aaaaaaaa-0000-0000-0000-0000000de0ff' from campaigns
 where id in ('aaaaaaaa-0000-0000-0000-000000001300');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000001301','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001300','Season 130'),
  ('aaaaaaaa-0000-0000-0000-000000001311','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001310','Other 130');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000001302','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001301',
   'Teaser','draft','00000000-0000-0000-0000-00000000a081','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000001303','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001301',
   'Post 1','draft','00000000-0000-0000-0000-00000000a081','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000001312','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001311',
   'Elsewhere','draft','00000000-0000-0000-0000-00000000a081','00000000-0000-0000-0000-00000000a001');

-- A single job can never carry the flag (d.1) — the check, before anyone is signed in.
select throws_ok($$
  update campaigns set has_phases = true where id = 'aaaaaaaa-0000-0000-0000-000000001320'
$$, '23514', null, 'a single job can never have phases — the check refuses the flag');

set local role authenticated;

-- ================================================================ TOGGLE ON ====
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a081'),true);
select throws_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001300', true) $$,
  '42501', null, 'a department lead may not turn phases on — the campaign''s shape is the AM''s');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001300', true) $$,
  '42501', null, 'a team member may not either');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a080'),true);
select throws_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001320', true) $$,
  '22023', null, 'the RPC refuses a single job in words');
select lives_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001300', true) $$,
  'the account manager turns phases on');
select results_eq($$
  select number, name, starts_on <= ends_on from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' order by number
$$, $$ values (1, 'Phase 1', true) $$, 'one phase, "Phase 1", spanning creation to go-live (d.5)');
select is((select count(*)::int from deliverables d where d.stream_id = 'aaaaaaaa-0000-0000-0000-000000001301'
             and d.phase_id = (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 1)),
  2, 'and every existing deliverable sits in it');
select is((select has_phases from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001300'), true, 'the flag is on');

-- The table is readable tenant-wide and has no write policy (RLS refuses even the AM directly).
select is((select count(*)::int from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300'), 1,
  'campaign_phases is readable by the tenant');
select throws_ok($$
  insert into campaign_phases (tenant_id, campaign_id, number, name, starts_on, ends_on)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001300', 9, 'Sneak', '2026-10-01', '2026-10-02')
$$, '42501', null, 'a direct insert into campaign_phases is refused — writes go through the RPCs only');

-- ================================================================ PHASES ====
select lives_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, 'Week 1', '2026-09-18', '2026-09-25')
$$, 'the AM adds a phase');
select lives_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, 'Week 2', '2026-09-24', '2026-10-02')
$$, 'and another that overlaps the first — allowed (d.2)');
select results_eq($$
  select number, name from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' order by number
$$, $$ values (1, 'Phase 1'), (2, 'Week 1'), (3, 'Week 2') $$, 'numbered in the order added');
select throws_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, 'Backwards', '2026-10-05', '2026-10-01')
$$, '22023', null, 'a phase that ends before it starts is refused');
select throws_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, '  ', '2026-10-01', '2026-10-05')
$$, '22023', null, 'a blank name is refused');
select lives_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300',
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 1),
    'Pre-Launch', '2026-09-01', '2026-09-17')
$$, 'the AM renames and re-dates Phase 1');
select is((select name from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 1),
  'Pre-Launch', 'saved');
select throws_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001310', null, 'Week 1', '2026-09-18', '2026-09-25')
$$, '22023', null, 'a phase cannot be added to a campaign whose phases are off');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a081'),true);
select throws_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, 'Week 3', '2026-10-03', '2026-10-09')
$$, '42501', null, 'a lead may not add a phase');

-- ================================================================ MOVE ====
-- The lead OWNS Teaser (project_tasks:manage in reach) — RLS lets the update through, the guard refuses.
select throws_ok($$
  select public.move_deliverable_to_phase('aaaaaaaa-0000-0000-0000-000000001302',
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 2))
$$, '42501', null, 'a lead may not move a deliverable between phases (the RPC)');
select throws_ok($$
  update deliverables set phase_id = (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 2)
   where id = 'aaaaaaaa-0000-0000-0000-000000001302'
$$, '42501', null, 'nor by a direct PATCH — the guard governs it identically (ADR-0037)');
-- The lead also owns Elsewhere, on the campaign whose phases are OFF.
select throws_ok($$
  update deliverables set phase_id = (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 2)
   where id = 'aaaaaaaa-0000-0000-0000-000000001312'
$$, '22023', null, 'a deliverable on an unphased campaign may not carry a phase (d.3)');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a080'),true);
select lives_ok($$
  select public.move_deliverable_to_phase('aaaaaaaa-0000-0000-0000-000000001302',
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 2))
$$, 'the AM moves Teaser into Week 1');
select throws_ok($$
  insert into deliverables (tenant_id, stream_id, name, state, owner_user_id, reviewer_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001301',
          'Phaseless', 'draft', '00000000-0000-0000-0000-00000000a081', '00000000-0000-0000-0000-00000000a001')
$$, '22023', null, 'a new deliverable on a phased campaign needs a phase (d.3)');
select throws_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001300', 'Post 2', '00000000-0000-0000-0000-00000000a081',
    null, 1, '2026-10-01 15:00+00', null, null)
$$, '22023', null, 'add_campaign_deliverable says so in words when no phase is chosen');
select lives_ok($$
  select public.add_campaign_deliverable('aaaaaaaa-0000-0000-0000-000000001300', 'Post 2', '00000000-0000-0000-0000-00000000a081',
    null, 1, '2026-10-01 15:00+00', null,
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 3),
    p_workstream => (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' limit 1))
$$, 'and adds it into Week 2 when one is');

-- ================================================================ DELETE ====
select throws_ok($$
  select public.delete_campaign_phase((select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 2))
$$, '22023', null, 'a phase holding a deliverable cannot be deleted — move it first (d.6)');
-- Empty Week 2 by moving Post 2 back into Pre-Launch, then delete it: Week 1 stays 2, nothing after it.
select lives_ok($$
  select public.move_deliverable_to_phase((select id from deliverables where name = 'Post 2' and stream_id = 'aaaaaaaa-0000-0000-0000-000000001301'),
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 1))
$$, 'Post 2 moved back');
select lives_ok($$
  select public.save_campaign_phase('aaaaaaaa-0000-0000-0000-000000001300', null, 'Week 3', '2026-10-03', '2026-10-09')
$$, 'a fourth phase, so renumbering has something to move');
select lives_ok($$
  select public.delete_campaign_phase((select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 3))
$$, 'the empty Week 2 is deleted');
select results_eq($$
  select number, name from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' order by number
$$, $$ values (1, 'Pre-Launch'), (2, 'Week 1'), (3, 'Week 3') $$, 'and Week 3 moved down to 3 — numbering stays contiguous');

-- ================================================================ TOGGLE OFF ====
-- Teaser is in Week 1; Post 1 and Post 2 in Pre-Launch: two phases hold work.
select throws_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001300', false) $$,
  '22023', null, 'turning phases off is refused while two phases hold deliverables (d.5)');
select lives_ok($$
  select public.move_deliverable_to_phase('aaaaaaaa-0000-0000-0000-000000001302',
    (select id from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300' and number = 1))
$$, 'Teaser moved into Pre-Launch — everything in one phase');
select lives_ok($$ select public.set_campaign_phases('aaaaaaaa-0000-0000-0000-000000001300', false) $$,
  'now phases can be turned off');
reset role;
select results_eq($$
  select (select has_phases from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001300'),
         (select count(*)::int from campaign_phases where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001300'),
         (select count(*)::int from deliverables where stream_id = 'aaaaaaaa-0000-0000-0000-000000001301' and phase_id is not null)
$$, $$ values (false, 0, 0) $$, 'the flag is off, the phases are gone, every phase_id is cleared');

select * from finish();
rollback;
