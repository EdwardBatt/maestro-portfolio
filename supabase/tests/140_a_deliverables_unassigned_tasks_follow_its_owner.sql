-- I53.29 (22 Sep) — a deliverable's UNASSIGNED tasks follow its DEPARTMENT: they take the new one
-- and lose their team, while an assigned task keeps its assignee's; and the correction in the
-- migration puts rows already left behind right. (Until the ADR-0060 addendum of 22 Sep this suite
-- also proved a team lead was refused BEFORE the owner change; that refusal is withdrawn — 141.)
--
-- ADR-0099 d.2/d.4 (23 Sep) changed what makes the department move, and this suite's name is now
-- half of the answer. The department was DERIVED from the owner (ADR-0050 d.2), so renaming the
-- owner moved the work — which is the 22 September fault itself: a Creative lead refused her own
-- team member because somebody else's name sat on the deliverable. The department is now the
-- deliverable's own and is chosen; the owner supplies it once, at creation, and never again. So
-- an owner change moves NOTHING, and the follow rule fires on the thing it was always about —
-- the department changing, which is now an explicit act (a workstream move, d.3/d.9).
begin;
select plan(8);
\ir helpers/seed.sql
select app.seed_tenant_brief_approval_grants(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1400', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 140'),
  ('aaaaaaaa-0000-0000-0000-000000de1401', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 140');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e140', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1400', 'Design 140');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0f0', 'am140@a.test'),
  ('00000000-0000-0000-0000-00000000a0f1', 'creativelead140@a.test'),
  ('00000000-0000-0000-0000-00000000a0f2', 'contentlead140@a.test'),
  ('00000000-0000-0000-0000-00000000a0f3', 'tl140@a.test'),
  ('00000000-0000-0000-0000-00000000a0f4', 'maker140@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a0f0','AM 140',           'account_manager', null, null),
  ('00000000-0000-0000-0000-00000000a0f1','Creative lead 140','department_lead','aaaaaaaa-0000-0000-0000-000000de1400', null),
  ('00000000-0000-0000-0000-00000000a0f2','Content lead 140', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1401', null),
  ('00000000-0000-0000-0000-00000000a0f3','TL 140',           'team_lead',      'aaaaaaaa-0000-0000-0000-000000de1400', 'aaaaaaaa-0000-0000-0000-00000007e140'),
  ('00000000-0000-0000-0000-00000000a0f4','Maker 140',        'team_member',    'aaaaaaaa-0000-0000-0000-000000de1400', 'aaaaaaaa-0000-0000-0000-00000007e140')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a0f0','00000000-0000-0000-0000-00000000a0f3');

-- An approved campaign; a deliverable owned by the CONTENT lead, with three tasks — one already
-- assigned to the maker (Creative / Design), two not. Its owner has accepted the task list, so
-- the second gate is out of the picture and only reach is tested (ADR-0100 d.2, which replaced
-- the two approved department briefs that used to stand here).
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001400','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 140','approved','campaign','00000000-0000-0000-0000-00000000a0f0','{"proposition":"Posts"}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f140','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001400','Season 140');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1400','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f140',
   'social posts 140','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a0f2');
-- The stamp is server-written only (ADR-0090 d.2, the fence), so the flag is raised exactly as
-- `public.approve_deliverable_tasks` raises it rather than the column being written behind it.
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = now(), tasks_approved_by = owner_user_id
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1400';
select set_config('app.task_list_approval', '', true);
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order, department_id, team_id, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1401','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1400','Create Content — social posts 1','todo',1,'aaaaaaaa-0000-0000-0000-000000de1400','aaaaaaaa-0000-0000-0000-00000007e140','00000000-0000-0000-0000-00000000a0f4', 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1402','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1400','Create Content — social posts 2','todo',2,'aaaaaaaa-0000-0000-0000-000000de1401',null,null, 8),
  ('aaaaaaaa-0000-0000-0000-0000000a1403','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1400','Create Content — social posts 3','todo',3,'aaaaaaaa-0000-0000-0000-000000de1401',null,null, 8);
-- The maker is bookable: a resource row in the team lead's own team.
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id, team_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e1400', 'aaaaaaaa-0000-0000-0000-000000000001', 'human', 'Maker 140', 'load_based', 120.0, 100.0,
   '00000000-0000-0000-0000-00000000a0f4', 'aaaaaaaa-0000-0000-0000-000000de1400', 'aaaaaaaa-0000-0000-0000-00000007e140');
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000a1401','00000000-0000-0000-0000-00000000a0f1');

select is((select department_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1400'),
  'aaaaaaaa-0000-0000-0000-000000de1401'::uuid,
  'fixture: the deliverable is Content''s — its owner supplied that ONCE, at creation (ADR-0099 d.2)');

-- ================================================================ THE OWNER CHANGES ====
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0f0'),true);
select lives_ok($$ select public.reassign_deliverable('aaaaaaaa-0000-0000-0000-0000000d1400', '00000000-0000-0000-0000-00000000a0f1') $$,
  'the account manager makes the Creative lead the owner');
reset role;
-- ADR-0102 (24 Sep): the owner change moves the deliverable to Creative, and its UNASSIGNED tasks
-- follow it there (ADR-0102 d.4, I53.29); the assigned one keeps its assignee's department.
select results_eq($$
  select d.department_id, st.id, st.department_id, st.team_id
    from sub_tasks st
    join deliverables d on d.id = st.deliverable_id
   where st.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1400' order by st.sort_order
$$, $$ values
  ('aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-0000000a1401'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e140'::uuid),
  ('aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-0000000a1402'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, null::uuid),
  ('aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-0000000a1403'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, null::uuid)
$$, 'the deliverable is Creative''s with its new owner, and its unassigned tasks followed (ADR-0102 d.1/d.4)');

-- ================================================================ AFTER: the team lead may ====
-- And she may although the task is still CONTENT's — the reach is hers by the ADR-0060 addendum,
-- not by the department having been moved under her. That is the 22 September fault answered
-- without moving anybody's work.
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0f3'),true);
select lives_ok($$
  select public.update_task_assignment('aaaaaaaa-0000-0000-0000-0000000a1402', 'Create Content — social posts 2', '00000000-0000-0000-0000-00000000a0f4',
    '[{"user_id":"00000000-0000-0000-0000-00000000a0f1","is_mandatory":true}]'::jsonb)
$$, 'now the Creative team lead assigns it to her team member');
reset role;
select is((select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1402'),
  '00000000-0000-0000-0000-00000000a0f4'::uuid, 'and it is assigned');

-- ================================================================ THE CORRECTION ====
-- A row left behind by an owner change made before this trigger existed. The correction reads the
-- DELIVERABLE's department as the truth and drags stragglers to it — the deliverable is Creative's
-- (its owner's), so the row it puts right is one stranded in Content.
update sub_tasks set department_id = 'aaaaaaaa-0000-0000-0000-000000de1401' where id = 'aaaaaaaa-0000-0000-0000-0000000a1403';
update sub_tasks st
   set department_id = d.department_id, team_id = null
  from deliverables d
 where d.id = st.deliverable_id and st.assignee_id is null and st.status <> 'cancelled'
   and d.department_id is not null and st.department_id is distinct from d.department_id;
select is((select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1403'),
  'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'the correction moves an unassigned task left behind to its deliverable''s department');
select is((select department_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1401'),
  'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'an assigned task is not the correction''s business');

-- ================================================================ THE DEPARTMENT CHANGES ====
-- What the follow rule was always for, now that the owner no longer triggers it: the department
-- itself moving, which after ADR-0099 d.3 is what putting a deliverable into a workstream does.
-- Its unassigned tasks go with it and lose their team; the ones somebody has committed to keep
-- the team the rule would have cleared (d.9). Proved on the column: a workstream move is one
-- write to it.
update deliverables set department_id = 'aaaaaaaa-0000-0000-0000-000000de1400'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1400';
select results_eq($$
  select id, department_id, team_id from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000d1400' order by sort_order
$$, $$ values
  ('aaaaaaaa-0000-0000-0000-0000000a1401'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e140'::uuid),
  ('aaaaaaaa-0000-0000-0000-0000000a1402'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, 'aaaaaaaa-0000-0000-0000-00000007e140'::uuid),
  ('aaaaaaaa-0000-0000-0000-0000000a1403'::uuid, 'aaaaaaaa-0000-0000-0000-000000de1400'::uuid, null::uuid)
$$, 'move the DEPARTMENT and the unassigned task follows with no team; the two assigned ones keep their assignee''s (ADR-0099 d.9)');

select * from finish();
rollback;
