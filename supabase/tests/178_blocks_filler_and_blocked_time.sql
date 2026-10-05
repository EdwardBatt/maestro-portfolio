-- I59.31 — filler on every field, and ADR-0107's blocks finished:
--   * E10     every brief field WITH text is checked at a single job's release and a campaign's
--             approval — optional ones too, a campaign's strategy and performance fields; a blank
--             optional field stays allowed. Text beginning "lorem ipsum" is filler (same cases as
--             src/lib/brief/filler.test.ts).
--   * E12     blocked minutes count the task's own inputs AND those on its whole deliverable, overlaps
--             once; another deliverable's input does not count.
--   * settled a block's kind is required from the maker; a cleared block stays cleared (for everyone);
--             clearing tells whoever waited (task_unblocked) — the maker for their own block, every open
--             task's assignee for a deliverable-level one — never the person clearing it.
--
-- a001 Admin A (approves; project_tasks:manage) · a003 Creative A, the maker (the team member's
-- project_tasks:manage removed, as 162 does) · a181 Owner 178 (department lead) · a182 Writer 178.
-- `notifications` is recipient-scoped: counts over it are read after `reset role` (traps.md).
begin;
select plan(21);
\ir helpers/seed.sql
select app.seed_tenant_brief_templates(id) from tenants;
delete from role_grants
 where resource = 'project_tasks' and action = 'manage'
   and role_id in (select id from roles where key = 'team_member');

-- ================================================================ the rule: lorem ipsum ====
select ok(app.is_filler_with('Lorem ipsum dolor sit amet, consectetur adipiscing elit', '{}')
          and app.is_filler_with('lorem ipsum — the new pack shot', '{}'),
  'settled: text beginning "lorem ipsum" is filler, however it goes on');
select ok(not app.is_filler_with('The lorem ipsum on the old KV must go', '{}'),
  'but a sentence that only mentions it is real');

-- ================================================================ E10: every field ====
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c1781', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Job 178', 'pending_approval', 'single_job', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000c1782', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 178', 'pending_approval', 'campaign', '00000000-0000-0000-0000-00000000a001');
insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, "values") values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000c1781', 'aaaaaaaa-0000-0000-0000-0000000de0ff',
   'single_execution', '{"task": "Resize the Ramadan KV for the metro screens", "specs": "", "restrictions": "TBD"}');
update campaigns set brief = '{"briefType": "360", "proposition": "The card that pays you back",
                               "insight": "Lorem ipsum dolor sit amet", "background": "",
                               "performance": {"objective": "Sign-ups", "budget": "XYZ"}}'::jsonb
 where id = 'aaaaaaaa-0000-0000-0000-0000000c1782';

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1781') $$,
  '22023', 'Restrictions still says ''TBD'' — write the real restrictions.',
  'E10: releasing a job whose OPTIONAL Restrictions says TBD is refused, named — a blank Specs is not');
reset role;
update campaign_briefs set "values" = '{"task": "Resize the Ramadan KV for the metro screens", "specs": "", "restrictions": "No gold on red"}'
 where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000c1781';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1781') $$,
  'E10: every field with text is real, the blank one left blank — released');

select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1782') $$,
  '22023', 'Insight still says ''Lorem ipsum dolor sit amet'' — write the real insight.',
  'E10: a campaign whose Insight (not its proposition) is lorem ipsum is refused — "briefType" 360 is not a field');
reset role;
update campaigns set brief = jsonb_set(brief, '{insight}', '"Students pay late and hate fees"')
 where id = 'aaaaaaaa-0000-0000-0000-0000000c1782';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1782') $$,
  '22023', 'Performance — budget still says ''XYZ'' — write the real performance — budget.',
  'E10: and the performance brief''s fields are checked too');
reset role;
update campaigns set brief = jsonb_set(brief, '{performance,budget}', '"$20k over six weeks"')
 where id = 'aaaaaaaa-0000-0000-0000-0000000c1782';
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$ select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000c1782') $$,
  'E10: all real — approved');
reset role;

-- ================================================================ the block fixture ====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000a181', 'owner178@a.test'),
                                          ('00000000-0000-0000-0000-00000000a182', 'writer178@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       'aaaaaaaa-0000-0000-0000-0000000de0ff'::uuid
from (values ('00000000-0000-0000-0000-00000000a181', 'Owner 178', 'department_lead'),
             ('00000000-0000-0000-0000-00000000a182', 'Writer 178', 'team_member')) as v(id, name, role_key);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id in ('00000000-0000-0000-0000-00000000a181', '00000000-0000-0000-0000-00000000a182');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into user_grants (tenant_id, user_id, resource, action, effect) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a181', 'project_tasks', 'manage', 'deny');
select set_config('request.jwt.claims', '', true);

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f178', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000e001', 'S178');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1781', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f178',
   'Film 178', 'in_progress', '00000000-0000-0000-0000-00000000a181', 'aaaaaaaa-0000-0000-0000-0000000de0ff', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d1782', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f178',
   'Other 178', 'in_progress', '00000000-0000-0000-0000-00000000a181', 'aaaaaaaa-0000-0000-0000-0000000de0ff', '00000000-0000-0000-0000-00000000a001');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-00000000e001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-000000001781', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'Edit 178', '00000000-0000-0000-0000-00000000a003', 'in_progress', 8),
  ('aaaaaaaa-0000-0000-0000-000000001782', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'Script 178', '00000000-0000-0000-0000-00000000a182', 'todo', 4),
  ('aaaaaaaa-0000-0000-0000-000000001783', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'Title card 178', '00000000-0000-0000-0000-00000000a003', 'todo', 1),
  ('aaaaaaaa-0000-0000-0000-000000001784', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'Old cut 178', '00000000-0000-0000-0000-00000000a182', 'cancelled', 2);

-- ================================================================ E12: both kinds of block ====
-- In the last 60 minutes: a deliverable-level input [-50, -20], the task's own [-30, -10] — the union is
-- [-50, -10] = 40, overlap once. Another deliverable's input and another task's own do not count.
insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from, requested_at, satisfied_at) values
  ('aaaaaaaa-0000-0000-0000-000000001b81', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', null,
   null, 'Logo pack', 'Kite Card', now() - interval '50 minutes', now() - interval '20 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b82', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'aaaaaaaa-0000-0000-0000-000000001781',
   'file', 'Music', 'Legal', now() - interval '30 minutes', now() - interval '10 minutes'),
  ('aaaaaaaa-0000-0000-0000-000000001b83', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1782', null,
   null, 'Elsewhere', 'Kite Card', now() - interval '60 minutes', null),
  ('aaaaaaaa-0000-0000-0000-000000001b84', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781', 'aaaaaaaa-0000-0000-0000-000000001782',
   'copy', 'Script notes', 'Copy', now() - interval '60 minutes', null);
select is(app.task_blocked_minutes('aaaaaaaa-0000-0000-0000-000000001781', now() - interval '60 minutes', now()), 40.0,
  'E12: the deliverable''s input and the task''s own, overlapping, count once — 40 minutes');
select is(app.task_blocked_minutes('aaaaaaaa-0000-0000-0000-000000001783', now() - interval '60 minutes', now()), 30.0,
  'E12: a task with no block of its own is still held by its deliverable''s input — 30');
delete from deliverable_pending_inputs where id in ('aaaaaaaa-0000-0000-0000-000000001b81', 'aaaaaaaa-0000-0000-0000-000000001b82',
                                                     'aaaaaaaa-0000-0000-0000-000000001b83', 'aaaaaaaa-0000-0000-0000-000000001b84');

-- ================================================================ the kind is required ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select ok(not app.has_permission('project_tasks', 'manage'), 'fixture: the maker holds no project_tasks:manage');
select throws_ok($$ insert into deliverable_pending_inputs (tenant_id, deliverable_id, sub_task_id, description, awaited_from)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781',
                           'aaaaaaaa-0000-0000-0000-000000001781', 'The voice-over', 'Copy team') $$,
  '22023', 'say what is missing — copy, the client, a file, a decision or something else',
  'settled: the maker must say what kind of thing is missing');
select lives_ok($$ insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
                   values ('aaaaaaaa-0000-0000-0000-000000001b85', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1781',
                           'aaaaaaaa-0000-0000-0000-000000001781', 'copy', 'The voice-over', 'Copy team') $$,
  'with the kind, raised');

-- ================================================================ clearing tells who waited ====
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a181'), true);
select lives_ok($$ update deliverable_pending_inputs set satisfied_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000001b85' $$,
  'the owner clears the maker''s block');
reset role;
select is((select array[type, entity_type, entity_id::text, detail->>'description'] from notifications
            where user_id = '00000000-0000-0000-0000-00000000a003' and type = 'task_unblocked'),
  array['task_unblocked', 'sub_task', 'aaaaaaaa-0000-0000-0000-000000001781', 'The voice-over'],
  'settled: the maker who waited is told — task_unblocked, on the task');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000a181' and type = 'task_unblocked'), 0,
  'never the person who cleared it');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok($$ update deliverable_pending_inputs set satisfied_at = null where id = 'aaaaaaaa-0000-0000-0000-000000001b85' $$,
  '22023', 'this block was cleared and stays cleared — raise a new one if it is back',
  'settled: the maker cannot un-clear it');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ update deliverable_pending_inputs set satisfied_at = null where id = 'aaaaaaaa-0000-0000-0000-000000001b85' $$,
  '22023', null, 'nor can a manager');

-- A deliverable-level input, raised and cleared by a manager.
select lives_ok($$ insert into deliverable_pending_inputs (id, tenant_id, deliverable_id, description, awaited_from)
                   values ('aaaaaaaa-0000-0000-0000-000000001b86', 'aaaaaaaa-0000-0000-0000-000000000001',
                           'aaaaaaaa-0000-0000-0000-0000000d1781', 'Brand fonts', 'Kite Card') $$,
  'a manager raises an input on the whole deliverable (no kind asked of a manager)');
select lives_ok($$ update deliverable_pending_inputs set satisfied_at = now() where id = 'aaaaaaaa-0000-0000-0000-000000001b86' $$,
  'and clears it');
reset role;
select results_eq($$
  select user_id, entity_type, jsonb_array_length(detail->'tasks') from notifications
   where type = 'task_unblocked' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1781' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a003'::uuid, 'deliverable', 2),
              ('00000000-0000-0000-0000-00000000a182'::uuid, 'deliverable', 1) $$,
  'settled: every open task''s assignee is told once, with their tasks — not for a cancelled task, not the clearer');

select ok(not has_function_privilege('anon', 'app.task_blocked_minutes(uuid, timestamptz, timestamptz)', 'execute'),
  'anon cannot read blocked minutes');

select * from finish();
rollback;
