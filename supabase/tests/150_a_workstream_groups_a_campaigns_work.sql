-- I56.3 / ADR-0099 (23 Sep) — a campaign's work is grouped into workstreams, and the three doors a
-- person uses: `save_workstream`, `move_deliverable_to_workstream`, `remove_workstream`.
--
--   * MAKE — a named group with a required department and an optional owner (d.1/d.3/d.5); the id
--     comes back, because the screen puts work into the group it has just made.
--   * NAMES — unique within the campaign, case-insensitively: "Always-on" and "always-on" are the
--     same group to everyone but a computer (d.7). Two campaigns may each have one. A group may
--     always be re-cased without colliding with itself.
--   * A MISSING DEPARTMENT — refused as a sentence, not as "null value in column department_id".
--   * MOVE IN — the grouping changes and NOTHING else does. Since ADR-0102 (24 Sep) a deliverable's
--     department is its OWNER's and a group no longer fills it in (supersedes ADR-0099 d.3): work a
--     Content owner holds, put into a Creative group, stays Content's, and not one task moves.
--   * MOVE OUT — the grouping goes and nothing else does (d.4), as before.
--   * REMOVE — an empty group goes; one still holding work is refused WITH THE COUNT (d.8),
--     because a refusal that does not say how much is in the way is one somebody has to go and
--     count. Deleting a group is never a way to delete work.
--   * RENAME + RE-DEPARTMENT — changing a group's department moves NONE of its work (ADR-0102 d.2):
--     the group's department labels it; each deliverable's is its owner's.
--   * AUTHORITY — all three doors are the campaign's authority's (`app.is_campaign_authority`), and
--     a team member holding project_tasks:manage — enough for the RLS on `deliverables` — is still
--     refused by each of them, in words. The grant is not the answer; reach over the campaign is.
begin;
select plan(25);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1500', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 150'),
  ('aaaaaaaa-0000-0000-0000-000000de1501', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 150');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e150', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1501', 'Copy 150');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a150', 'am150@a.test'),
  ('00000000-0000-0000-0000-00000000a151', 'creativelead150@a.test'),
  ('00000000-0000-0000-0000-00000000a152', 'contentlead150@a.test'),
  ('00000000-0000-0000-0000-00000000a153', 'contentmaker150@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a150','AM 150',           'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a151','Creative lead 150','department_lead','aaaaaaaa-0000-0000-0000-000000de1500', null),
  ('00000000-0000-0000-0000-00000000a152','Content lead 150', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1501', null),
  ('00000000-0000-0000-0000-00000000a153','Content maker 150','team_member',    'aaaaaaaa-0000-0000-0000-000000de1501', 'aaaaaaaa-0000-0000-0000-00000007e150')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id = '00000000-0000-0000-0000-00000000a150';

-- Two campaigns, both the AM's: one to group, and a second that proves a name belongs to ITS
-- campaign and not to the tenant (d.7).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001500','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 150','approved','campaign','00000000-0000-0000-0000-00000000a150'),
  ('aaaaaaaa-0000-0000-0000-000000001510','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Other 150','approved','campaign','00000000-0000-0000-0000-00000000a150');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f150','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001500','Season 150'),
  ('aaaaaaaa-0000-0000-0000-00000000f151','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001510','Other 150');

-- Two ungrouped deliverables, both CONTENT's — their owner supplied that once, at creation
-- (ADR-0099 d.2). Ungrouped work is a normal, permanent state (d.1), so this is what the campaign
-- looks like before anybody makes a group. Inserted as the superuser with no JWT, which is how a
-- fixture escapes the owner/department guard (ADR-0100 d.8).
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1500','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f150',
   'social posts 150','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a152'),
  ('aaaaaaaa-0000-0000-0000-0000000d1501','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f150',
   'key visuals 150','draft', now() + interval '12 days', '00000000-0000-0000-0000-00000000a152');

-- Two tasks on the first deliverable: one the Content maker has been given, one nobody has. d.9 is
-- the difference between them and there is no other way to see it.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, team_id, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1501','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1500',
   'Write copy — social posts 150','todo',1,'aaaaaaaa-0000-0000-0000-000000de1501','aaaaaaaa-0000-0000-0000-00000007e150','00000000-0000-0000-0000-00000000a153', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1502','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1500',
   'Write copy — social posts 150 b','todo',2,'aaaaaaaa-0000-0000-0000-000000de1501','aaaaaaaa-0000-0000-0000-00000007e150',null, null);

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a150'),true);

-- ================================================================ MAKE ====
-- The id comes back because the caller needs it: the work screen makes a group and immediately
-- drops the deliverables the person dragged into it. A void return would make that two round trips
-- and a lookup by name, which is the one thing d.7 allows to be edited.
select isnt(
  public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'Always-on',
    'aaaaaaaa-0000-0000-0000-000000de1500', '00000000-0000-0000-0000-00000000a151'),
  null::uuid, 'the account manager makes a workstream, and gets its id back (d.1)');
select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'Content refresh',
    'aaaaaaaa-0000-0000-0000-000000de1501', null)
$$, 'and one with no owner — d.5 says the owner is chosen, not that it is required');
select results_eq($$
  select name, department_id, owner_user_id from workstreams
   where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' order by name
$$, $$ values
  ('Always-on',       'aaaaaaaa-0000-0000-0000-000000de1500'::uuid, '00000000-0000-0000-0000-00000000a151'::uuid),
  ('Content refresh', 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid, null::uuid)
$$, 'each group is a name, a department and an owner the campaign chose (d.1/d.3/d.5)');

-- ================================================================ NAMES ====
-- d.7. "Always-on" and "always-on" are one group to every person who will ever read the screen, so
-- the second is refused — and refused as a sentence, because the unique index behind it says
-- "duplicate key value violates unique constraint uq_workstreams_campaign_name", which is not
-- something to show anybody.
select throws_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'always-on',
    'aaaaaaaa-0000-0000-0000-000000de1500', null)
$$, '23505', 'This campaign already has a workstream called "Always-on".',
  'a name that differs only in case is the same name, and the refusal NAMES the group in the way');
-- The message quotes "Always-on", the group that already exists, not "always-on", the words
-- just typed (`20260923220000`). Echoing the typing tells somebody their name is taken without
-- telling them what by, and a collision only in case is exactly when that matters.
select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001510', 'Always-on',
    'aaaaaaaa-0000-0000-0000-000000de1500', null)
$$, 'a DIFFERENT campaign may have its own "Always-on" — the name belongs to the campaign (d.7)');
-- Uniqueness must not lock a group out of its own name: without the `w.id <> p_workstream` in the
-- check, fixing the capitals on a group would report the group itself as the clash.
select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'Content Refresh',
    'aaaaaaaa-0000-0000-0000-000000de1501', null,
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Content refresh'))
$$, 'a group can be re-cased — it does not collide with itself (d.7)');
select is((select count(*)::int from workstreams
            where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Content Refresh'),
  1, 'and the new capitals are saved');

-- ================================================================ A DEPARTMENT IS REQUIRED ====
-- d.3. The column is NOT NULL, so this would be refused either way; what is asserted here is that
-- it is refused BEFORE the insert, in words. A person who leaves the department picker alone should
-- be told what a department is for, not shown the name of a column.
select throws_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'No department', null, null)
$$, '22023', 'A workstream needs a department: it labels the group and starts its owner list.',
  'a workstream with no department is refused as a sentence, not as a NOT NULL violation (d.3)');

-- ================================================================ MOVE IN ====
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1500'),
  'aaaaaaaa-0000-0000-0000-000000de1501'::uuid,
  'fixture: the work is Content''s before anybody groups it (ungrouped is a normal state, d.1)');
select lives_ok($$
  select public.move_deliverable_to_workstream('aaaaaaaa-0000-0000-0000-0000000d1500',
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Always-on'))
$$, 'the account manager puts a deliverable into the Creative group');
-- ADR-0102 d.2 (24 Sep): the group no longer sets the department. The work is in the Creative group
-- and still Content's — its owner is Content's lead, and the department is the owner's.
select results_eq($$
  select d.workstream_id = w.id, d.department_id
    from deliverables d
    join workstreams w on w.campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and w.name = 'Always-on'
   where d.id = 'aaaaaaaa-0000-0000-0000-0000000d1500'
$$, $$ values (true, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid) $$,
  'it is in the group and STILL Content''s — the department is the owner''s, not the group''s (ADR-0102 d.2)');
-- And so nothing followed: the unassigned task and the assigned one are where they were.
select results_eq($$
  select id, department_id, team_id from sub_tasks
   where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1500' order by sort_order
$$, $$ values
  ('aaaaaaaa-0000-0000-0000-0000000a1501'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e150'::uuid),
  ('aaaaaaaa-0000-0000-0000-0000000a1502'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e150'::uuid)
$$, 'not one task moved — the deliverable''s department did not change (ADR-0102 d.2)');

-- ================================================================ MOVE OUT ====
-- d.4, and the assertion most likely to regress: the obvious symmetry — "the group set the
-- department, so removing the group clears it" — is wrong, and wrong in a way nobody would notice
-- until work went quietly invisible to the department that was doing it. Ungrouping changes the
-- grouping and nothing else.
select lives_ok($$
  select public.move_deliverable_to_workstream('aaaaaaaa-0000-0000-0000-0000000d1500', null)
$$, 'and takes it back out again');
select results_eq($$
  select workstream_id, department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1500'
$$, $$ values (null::uuid, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid) $$,
  'ungrouped, and still its owner''s department — removing a grouping never moves work (d.4)');
select results_eq($$
  select id, department_id, team_id from sub_tasks
   where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1500' order by sort_order
$$, $$ values
  ('aaaaaaaa-0000-0000-0000-0000000a1501'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e150'::uuid),
  ('aaaaaaaa-0000-0000-0000-0000000a1502'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e150'::uuid)
$$, 'and not one task moved either — nothing followed a department that did not change');

-- A group belongs to ONE campaign: the partition is per campaign, not per tenant (d.1, "locked in").
select throws_ok($$
  select public.move_deliverable_to_workstream('aaaaaaaa-0000-0000-0000-0000000d1500',
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001510' and name = 'Always-on'))
$$, 'P0002', null, 'and it cannot be put into another campaign''s group of the same name');

-- ================================================================ REMOVE ====
select lives_ok($$
  select public.move_deliverable_to_workstream(d.id,
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Always-on'))
    from deliverables d where d.stream_id = 'aaaaaaaa-0000-0000-0000-00000000f150'
$$, 'both deliverables go into Always-on');
-- d.8. The count is the point: "still holds work" leaves a person to go and find out how much, and
-- the alternative to refusing is a cascade, which would make deleting a group a way to delete work.
select throws_ok($$
  select public.remove_workstream(
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Always-on'))
$$, '23503', 'The workstream "Always-on" still holds 2 pieces of work. Move them out or remove them first.',
  'a group still holding work is refused, and the refusal says how much is in the way (d.8)');
select lives_ok($$
  select public.remove_workstream(
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Content Refresh'))
$$, 'an EMPTY group is removed');
select results_eq($$
  select name from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500'
$$, $$ values ('Always-on') $$, 'and only it went');

-- ================================================================ RENAME + RE-DEPARTMENT ====
-- ADR-0102 d.2: changing a group's department moves none of its work. The two deliverables are
-- their owner's (Content's) before and after; suite 156 proves it with work of another department.
select lives_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'Always-on, Content',
    'aaaaaaaa-0000-0000-0000-000000de1501', '00000000-0000-0000-0000-00000000a152',
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Always-on'))
$$, 'the group is renamed and moved to Content');
select results_eq($$
  select d.name, d.department_id from deliverables d
   where d.stream_id = 'aaaaaaaa-0000-0000-0000-00000000f150' order by d.name
$$, $$ values
  ('key visuals 150',  'aaaaaaaa-0000-0000-0000-000000de1501'::uuid),
  ('social posts 150', 'aaaaaaaa-0000-0000-0000-000000de1501'::uuid)
$$, 'and the work in it is still its owners'' department (ADR-0102 d.2)');

-- ================================================================ AUTHORITY ====
-- A team member. The fixture grants them project_tasks:manage on purpose (helpers/seed.sql), which
-- is exactly what the RLS write policy on `deliverables` asks for — so if these three doors were
-- left to RLS, the move would go through. Shaping a campaign's work is the campaign's authority's:
-- its account manager, Traffic, an Account Director, a Power Admin.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  select public.save_workstream('aaaaaaaa-0000-0000-0000-000000001500', 'Mine now',
    'aaaaaaaa-0000-0000-0000-000000de1500', null)
$$, '42501', 'You cannot change this campaign''s workstreams: it is outside your reach. Ask its account manager, an Account Director or Traffic.',
  'someone outside the campaign cannot make a group, and is told who can');
select throws_ok($$
  select public.move_deliverable_to_workstream('aaaaaaaa-0000-0000-0000-0000000d1500', null)
$$, '42501', 'You cannot move this work between workstreams: it is outside your reach. Ask its account manager, an Account Director or Traffic.',
  'nor move work between groups — the project_tasks grant is not the answer, reach over the campaign is');
select throws_ok($$
  select public.remove_workstream(
    (select id from workstreams where campaign_id = 'aaaaaaaa-0000-0000-0000-000000001500' and name = 'Always-on, Content'))
$$, '42501', 'You cannot remove this workstream: it is outside your reach. Ask its account manager, an Account Director or Traffic.',
  'nor remove one');

select * from finish();
rollback;
