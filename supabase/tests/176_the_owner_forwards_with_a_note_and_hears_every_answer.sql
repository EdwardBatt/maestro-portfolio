-- I59.31 — ADR-0109's owner step and ADR-0110's change request, as answered on 25 Sep:
--
--   * E3        the owner's forwarding note is required.
--   * E4        the owner who forwarded a request is told of the account manager's answer — approval
--               and refusal — with the existing types, detail.to_owner.
--   * settled   a request the OWNER raises skips the owner step.
--   * E5        a due change asks for evidence and never requires it; the request and the logged change
--               record whether it came (and which file); a file from another campaign is refused.
--   * E6        a change request never carries the department; a lone department edit on started work
--               is refused; the owner changes straight away (reassign_deliverable) and the department
--               follows.
--   * E7        accepting a type change cancels the old type's OPEN tasks (a reason naming the request,
--               the assignee told, the bookings freed), keeps finished and hand-added ones, adds the new
--               type's list unassigned and un-approved; a type sharing the old one's workflow changes
--               nothing on the list.
--
-- `notifications` is recipient-scoped: every count over it is read after `reset role` (traps.md).
begin;
select plan(37);
\ir helpers/seed.sql
-- ADR-0141 d.5: the request is retired; a pending one (raised before 3 Oct) is raised here as it was then.
\ir helpers/legacy_extension_request.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1760', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 176'),
  ('aaaaaaaa-0000-0000-0000-000000de1761', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 176');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e176', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1760', 'Design 176');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a760', 'am176@a.test'),
  ('00000000-0000-0000-0000-00000000a761', 'owner176@a.test'),
  ('00000000-0000-0000-0000-00000000a762', 'maker176@a.test'),
  ('00000000-0000-0000-0000-00000000a763', 'otherlead176@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a760','AM 176',         'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a761','Owner 176',      'department_lead','aaaaaaaa-0000-0000-0000-000000de1760', null),
  ('00000000-0000-0000-0000-00000000a762','Maker 176',      'team_member',    'aaaaaaaa-0000-0000-0000-000000de1760', 'aaaaaaaa-0000-0000-0000-00000007e176'),
  ('00000000-0000-0000-0000-00000000a763','Other lead 176', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1761', null)
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000a76%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e1762', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 176', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-00000000a762', 'aaaaaaaa-0000-0000-0000-000000de1760', 'aaaaaaaa-0000-0000-0000-00000007e176');

-- Two workflows; three types — TA and TC share W1, TB is W2.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000076b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'W176A', 'Static 176', false),
  ('aaaaaaaa-0000-0000-0000-0000000076b2', 'aaaaaaaa-0000-0000-0000-000000000001', 'W176B', 'Motion 176', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en) values
  ('aaaaaaaa-0000-0000-0000-0000000076c1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000076b1', 1, 'Design'),
  ('aaaaaaaa-0000-0000-0000-0000000076c2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000076b1', 2, 'Resize'),
  ('aaaaaaaa-0000-0000-0000-0000000076c3', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000076b2', 1, 'Animate');
insert into deliverable_categories (tenant_id, code, name_en) values ('aaaaaaaa-0000-0000-0000-000000000001', 'CR176', 'Category 176');
insert into deliverable_types (id, tenant_id, code, category_code, name_en, default_workflow_template_id) values
  ('aaaaaaaa-0000-0000-0000-0000000c176a', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR176-A', 'CR176', 'Banner', 'aaaaaaaa-0000-0000-0000-0000000076b1'),
  ('aaaaaaaa-0000-0000-0000-0000000c176b', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR176-B', 'CR176', 'Motion banner', 'aaaaaaaa-0000-0000-0000-0000000076b2'),
  ('aaaaaaaa-0000-0000-0000-0000000c176c', 'aaaaaaaa-0000-0000-0000-000000000001', 'CR176-C', 'CR176', 'Poster', 'aaaaaaaa-0000-0000-0000-0000000076b1');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001760', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Season 176', 'approved', 'campaign', '00000000-0000-0000-0000-00000000a760');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f176', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001760', 'S176');
-- D1 (the type change), D2 (due, department, owner, extensions), D3 (a type on the same workflow).
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, department_id, deliverable_type_id, quantity) values
  ('aaaaaaaa-0000-0000-0000-0000000d1761', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f176',
   'Banner 176', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000a761', 'aaaaaaaa-0000-0000-0000-000000de1760',
   'aaaaaaaa-0000-0000-0000-0000000c176a', 1),
  ('aaaaaaaa-0000-0000-0000-0000000d1762', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f176',
   'Leaflet 176', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000a761', 'aaaaaaaa-0000-0000-0000-000000de1760',
   null, 1),
  ('aaaaaaaa-0000-0000-0000-0000000d1763', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f176',
   'Poster 176', 'in_progress', '2026-10-20 15:00:00+00', '00000000-0000-0000-0000-00000000a761', 'aaaaaaaa-0000-0000-0000-000000de1760',
   'aaaaaaaa-0000-0000-0000-0000000c176a', 1);
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001760');

-- Give the materialised tasks their state: D1 Design in progress (booked), D1 Resize done, a hand-added
-- D1 task to do; D3 Design in progress. D2 has one task of its own, in progress.
set local app.system_op = 'on';
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a762', sla_hours = 6, status = 'in_progress',
       starts_at = '2026-10-01 06:00+00', due_at = '2026-10-05 15:00+00'
 where deliverable_id in ('aaaaaaaa-0000-0000-0000-0000000d1761', 'aaaaaaaa-0000-0000-0000-0000000d1763')
   and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000076c1';
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a762', sla_hours = 2, status = 'done'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761' and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000076c2';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000a1769', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1761', 'Hand-added 176', 'todo', 9);
insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, department_id, team_id, title, status, starts_at, due_at, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1762', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1762',
   '00000000-0000-0000-0000-00000000a762', 'aaaaaaaa-0000-0000-0000-000000de1760', 'aaaaaaaa-0000-0000-0000-00000007e176',
   'Leaflet art 176', 'in_progress', '2026-10-01 06:00:00+00', '2026-10-05 15:00:00+00', 8);
insert into bookings (tenant_id, resource_id, starts_at, ends_at, state, sub_task_id)
select 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e1762', '2026-10-01 06:00+00', '2026-10-01 12:00+00',
       'confirmed', t.id
  from sub_tasks t where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761' and t.workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000076c1';
set local app.system_op = 'off';

-- Evidence: one file in this campaign's folders, one in another campaign's.
insert into asset_folders (id, tenant_id, client_id, campaign_id, name, kind) values
  ('aaaaaaaa-0000-0000-0000-0000000076f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-000000001760', 'References', 'asset_type'),
  ('aaaaaaaa-0000-0000-0000-0000000076f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'References', 'asset_type');
insert into assets (id, tenant_id, folder_id, name, provider, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000076a1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000076f1',
   'client-agrees.png', 'b2', 'k/176/agrees.png', 'image/png'),
  ('aaaaaaaa-0000-0000-0000-0000000076a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000076f2',
   'elsewhere.png', 'b2', 'k/176/elsewhere.png', 'image/png');

-- ================================================================ E3 / E4: the owner's step ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a762'), true);
select lives_ok($$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1762', '2026-10-09', 'Two more sizes', 'client') $$,
  'the maker asks for an extension — it goes to the owner first');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select throws_ok($$ select public.forward_extension((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762')) $$,
  '22023', 'Say what you think of this request — your note goes to the account manager with it.',
  'E3: the owner cannot forward without a note');
select throws_ok($$ select public.forward_extension((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'), '   ') $$,
  '22023', null, 'E3: nor with a blank one');
select lives_ok($$ select public.forward_extension((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'), 'Fair — the client added sizes') $$,
  'E3: with a note, forwarded');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select lives_ok($$ select public.sub_task_extension_decide((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'), true, 'Agreed') $$,
  'the account manager approves');

-- A second request, forwarded and refused.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a762'), true);
select lives_ok($$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1762', '2026-10-14', 'And a video', 'client') $$,
  'the maker asks again');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select public.forward_extension((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'), 'I would not') $$, 'forwarded');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select lives_ok($$ select public.sub_task_extension_decide((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'), false, 'No — the date holds') $$,
  'the account manager refuses');
reset role;
select is(
  (select array_agg(type || ':' || coalesce(detail ->> 'to_owner', '-') order by created_at, type)
     from notifications where user_id = '00000000-0000-0000-0000-00000000a761'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1762' and type in ('extension_approved', 'extension_refused')),
  array['extension_approved:true', 'extension_refused:true'],
  'E4: the owner who forwarded both is told of both answers, marked to_owner');
select is(
  (select array_agg(type || ':' || coalesce(detail ->> 'to_owner', '-') order by created_at, type)
     from notifications where user_id = '00000000-0000-0000-0000-00000000a762'
      and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1762' and type in ('extension_approved', 'extension_refused')),
  array['extension_approved:-', 'extension_refused:-'],
  'the maker is told as before — not marked to_owner');
select is((select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000a760'
            and type in ('extension_approved', 'extension_refused')), 0,
  'never the account manager about her own answer');

-- settled: the owner asks — the owner step is skipped.
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000a1762', '2026-10-16', 'The shoot moved', 'dependency') $$,
  'the owner asks for an extension on a task of their own deliverable');
select is((select array[stage, owner_step::text] from public.sub_task_extension_requests where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'),
  array['am', 'false'], 'settled: the owner asked, so it is straight at the account manager''s step');
reset role;
select is((select detail ->> 'stage' from notifications where user_id = '00000000-0000-0000-0000-00000000a760'
            and type = 'extension_requested' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000a1762'),
  'am', 'and the account manager is asked, at her step');

-- ================================================================ E5: evidence asked for ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select throws_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1762', '{"due":{"to":"2026-10-25"}}', 'client',
                     null, 'aaaaaaaa-0000-0000-0000-0000000076a2') $$,
  '22023', null, 'E5: a file from another campaign is not this change''s evidence');
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1762', '{"due":{"to":"2026-10-25"}}', 'client',
                     null, 'aaaaaaaa-0000-0000-0000-0000000076a1') $$,
  'E5: the account manager asks for a new due date, with the client''s email attached');
select is((select array[evidence_attached::text, evidence_asset_id::text] from deliverable_change_requests
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1762' and status = 'pending'),
  array['true', 'aaaaaaaa-0000-0000-0000-0000000076a1'], 'E5: the request records the evidence');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select public.answer_change_request((select id from deliverable_change_requests
                     where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1762' and status = 'pending'), 'accept') $$,
  'the owner accepts');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1762', '{"due":{"to":"2026-10-27"}}', 'client') $$,
  'E5: a second due change, with no evidence at all — asked for, not required');
select is((select evidence_attached from deliverable_change_requests
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1762' and status = 'pending'), false,
  'E5: recorded as sent without evidence');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select public.answer_change_request((select id from deliverable_change_requests
                     where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1762' and status = 'pending'), 'accept') $$,
  'and accepted');
reset role;
select is(
  (select array_agg((payload ->> 'to')::timestamptz::text || ':' || (payload ->> 'evidence_attached') || ':' || coalesce(payload ->> 'evidence_asset_id', '-')
                    order by created_at)
     from sla_events where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1762' and event_type = 'deadline_changed'
      and payload ? 'change_request_id'),
  array['2026-10-25 15:00:00+00:true:aaaaaaaa-0000-0000-0000-0000000076a1', '2026-10-27 15:00:00+00:false:-'],
  'E5: each change of the promise is logged with whether evidence came, and which file');

-- ================================================================ E6: no department ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select throws_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1762',
                     jsonb_build_object('department', jsonb_build_object('to', 'aaaaaaaa-0000-0000-0000-000000de1761')), 'us') $$,
  '22023', 'A deliverable''s department follows its owner — use Change owner instead; it saves straight away.',
  'E6: a change request never carries the department');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-000000de1761' where id = 'aaaaaaaa-0000-0000-0000-0000000d1762';
select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1762'),
  'aaaaaaaa-0000-0000-0000-000000de1760'::uuid,
  'E6: a department written alone does not move it — it is the owner''s (ADR-0102''s stamp puts it back)');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select lives_ok($$ select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000d1762', '00000000-0000-0000-0000-00000000a763') $$,
  'E6: Change owner on started work saves straight away — no request');
select is((select array[owner_user_id::text, department_id::text] from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1762'),
  array['00000000-0000-0000-0000-00000000a763', 'aaaaaaaa-0000-0000-0000-000000de1761'],
  'E6: and the department follows the new owner (ADR-0102)');

-- ================================================================ E7: a type change ====
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1761',
                     '{"type":{"to":"aaaaaaaa-0000-0000-0000-0000000c176b"}}', 'client') $$,
  'the account manager asks for the banner to become a motion banner');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select public.answer_change_request((select id from deliverable_change_requests
                     where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761' and status = 'pending'), 'accept') $$,
  'E7: the owner accepts the type change on started work');
reset role;
select is(
  (select array_agg(coalesce(ws.title_en, t.title) || ':' || t.status || ':' || (t.assignee_id is not null)::text order by t.sort_order, t.title)
     from sub_tasks t left join workflow_steps ws on ws.id = t.workflow_step_id
    where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761'),
  array['Animate:todo:false', 'Design:cancelled:true', 'Resize:done:true', 'Hand-added 176:todo:false'],
  'E7: the old type''s open task is cancelled, the finished one and the hand-added one kept, the new type''s added unassigned');
select is((select deliverable_type_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1761'),
  'aaaaaaaa-0000-0000-0000-0000000c176b'::uuid, 'E7: the type is the new one');
select ok((select tasks_approved_at is null and tasks_approved_by is null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1761'),
  'E7: the task list is NOT approved — the owner approves it again (ADR-0100)');
select is(
  (select count(*)::int from audit_events a join sub_tasks t on t.id = a.entity_id
    where a.action = 'task_cancelled' and t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761'
      and a.payload ->> 'change_request_id' = (select id::text from deliverable_change_requests
                                                where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761')
      and a.payload ->> 'reason' like '%change request%'),
  1, 'E7: the cancellation is on the record with a reason naming the request');
select ok(
  (select detail ->> 'reason' like '%change request%' from notifications
    where user_id = '00000000-0000-0000-0000-00000000a762' and type = 'cancelled'
      and entity_id = (select id from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761'
                                                   and workflow_step_id = 'aaaaaaaa-0000-0000-0000-0000000076c1')),
  'E7: the maker of the cancelled task is told why');
select is(
  (select count(*)::int from bookings b join sub_tasks t on t.id = b.sub_task_id
    where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1761' and t.status = 'cancelled'),
  0, 'E7: the cancelled task''s booking is released');

-- The same workflow under another type: nothing on the list moves.
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a760'), true);
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1763',
                     '{"type":{"to":"aaaaaaaa-0000-0000-0000-0000000c176c"}}', 'us') $$, 'Poster: Banner → Poster, one workflow');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a761'), true);
select lives_ok($$ select public.answer_change_request((select id from deliverable_change_requests
                     where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1763' and status = 'pending'), 'accept') $$, 'accepted');
reset role;
select ok(
  (select count(*) = 2 and bool_and(status <> 'cancelled') from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1763')
  and (select tasks_approved_at is not null from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1763'),
  'E7: a type on the same workflow cancels nothing, adds nothing, and the approval stands');

select * from finish();
rollback;
