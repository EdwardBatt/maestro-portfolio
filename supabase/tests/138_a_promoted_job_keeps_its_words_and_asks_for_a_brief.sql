-- I53.20 (21 Sep, option C) — promoting a job: the request's words and the job brief's task become
-- the campaign brief (the job brief kept under promotedJobBrief); an assignment already made stands.
-- ADR-0104 (25 Sep) d.1: the department's brief row is LEFT ALONE — approved, read-only, its words
-- intact; it used to be re-opened and emptied, which left an unapproved empty legacy row (I57.41). And the master brief's edit
-- MERGES, keeping the request.
--
-- ADR-0100 (23 Sep) took the gate off that re-opened row. Promotion used to close assignment
-- behind the department's brief (ADR-0072 d.6); the second gate is now the deliverable OWNER's
-- approval of the task list, the same one a single job already used (d.2). So promotion no longer
-- withdraws anything — work released before it stays released — and what decides is the stamp,
-- not the document. The re-open and its audit lines stay: d.3 keeps the 216 existing rows as the
-- record of what a department was asked to do, and d.6 retires the approver machinery rather than
-- deleting it, so this suite still drives both.
begin;
select plan(12);
\ir helpers/seed.sql
select app.seed_tenant_brief_approval_grants(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1380', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 138');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a0e0', 'am138@a.test'),
  ('00000000-0000-0000-0000-00000000a0e1', 'lead138@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a0e0','AM 138',   'account_manager', null),
  ('00000000-0000-0000-0000-00000000a0e1','Lead 138', 'department_lead','aaaaaaaa-0000-0000-0000-000000de1380')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a0e0','00000000-0000-0000-0000-00000000a0e1');

-- A released single job: the request record in campaigns.brief, its six-field brief approved with
-- the job, one deliverable with its task list approved and one task already assigned.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, brief) values
  ('aaaaaaaa-0000-0000-0000-000000001380','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Teaser 138','approved','single_job','00000000-0000-0000-0000-00000000a0e0',
   '{"kind":"single_job","request":{"askedBy":"Client 138","source":"email","words":"One teaser for the launch"},"deliverables":[]}'::jsonb);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f139','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001380','Teaser 138');
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id, tasks_approved_at) values
  ('aaaaaaaa-0000-0000-0000-0000000d1380','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000f139',
   'Teaser 138','draft', now() + interval '10 days', '00000000-0000-0000-0000-00000000a0e1', now());
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000a1380','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000d1380','Design 138','todo','00000000-0000-0000-0000-00000000a003', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000a1380','00000000-0000-0000-0000-00000000a0e1');
insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, "values", approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cb138','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001380',
   'aaaaaaaa-0000-0000-0000-000000de1380','single_execution','{"task":"Design one teaser","deliverableType":"Social Advertisement"}',
   now(), '00000000-0000-0000-0000-00000000a0e0');

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0e0'),true);

-- Before: the job's deliverable is offered (its task list is approved).
select ok(
  exists (select 1 from public.assignable_deliverables('aaaaaaaa-0000-0000-0000-000000001380') where id = 'aaaaaaaa-0000-0000-0000-0000000d1380'),
  'before promotion the job''s deliverable is offered on the schedule (ADR-0090)');

select lives_ok($$ select public.promote_single_job('aaaaaaaa-0000-0000-0000-000000001380') $$, 'the account manager promotes the job');

-- 1. The words became the campaign's brief.
select results_eq($$
  select kind, brief ->> 'background', brief ->> 'task', brief -> 'request' ->> 'words', brief ? 'kind',
         brief -> 'promotedJobBrief' ->> 'briefType', brief -> 'promotedJobBrief' -> 'values' ->> 'task'
    from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001380'
$$, $$ values ('campaign', 'One teaser for the launch', 'Design one teaser', 'One teaser for the launch', false,
               'single_execution', 'Design one teaser') $$,
  'the request''s words are the background, the job brief''s task the task; the request stays; the job brief is kept whole under promotedJobBrief; kind (the marker) is gone');

-- 2. ADR-0104 d.1: the department's row is untouched — still approved, its words intact, no audit
--    line for a re-open or a reset.
select results_eq($$
  select approved_at is not null, approved_by, "values" ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb138'
$$, $$ values (true, '00000000-0000-0000-0000-00000000a0e0'::uuid, 'Design one teaser') $$,
  'the job''s brief row is left as it was — approved, with its words (ADR-0104 d.1)');
reset role;   -- the audit log is read by admins; the assertion reads it as the database
select is(
  (select count(*)::int from audit_events where entity_id = 'aaaaaaaa-0000-0000-0000-0000000cb138' and action = 'department_brief_reopened'),
  0, 'promotion no longer re-opens it (ADR-0104 d.1)');
select is(
  (select count(*)::int from audit_events where entity_id = 'aaaaaaaa-0000-0000-0000-0000000cb138' and action = 'department_brief_reset_on_promotion'),
  0, 'nor empties it (ADR-0104 d.1)');
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0e0'),true);

-- 3. Promotion withdraws nothing, and the assignment already made stands.
-- This asked, until ADR-0100, whether promotion had CLOSED assignment — emptying the department's
-- brief row closed ADR-0072 d.6's gate behind it. d.2 moved that gate to the owner's acceptance of
-- the task list, which this owner gave before the promotion and which promotion does not touch. So
-- the answer inverts: work whose owner has accepted it is not taken away by a change of the
-- campaign's shape around it.
select ok(
  exists (select 1 from public.assignable_deliverables('aaaaaaaa-0000-0000-0000-000000001380') where id = 'aaaaaaaa-0000-0000-0000-0000000d1380'),
  'after promotion the deliverable is still offered: its owner''s acceptance stands, and emptying the brief row no longer gates anything (ADR-0100 d.2)');
select is(
  (select assignee_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000a1380'),
  '00000000-0000-0000-0000-00000000a003'::uuid, 'the task already assigned stays assigned');
select throws_ok($$ select public.promote_single_job('aaaaaaaa-0000-0000-0000-000000001380') $$, '22023', null,
  'a second press is refused — it is a campaign now');

-- 4. Which of the two actually decides. The department brief still opens and closes — ADR-0100 d.6
--    retires the approver machinery, it does not delete it — and approving it changes nothing.
--    Withdraw the OWNER's acceptance instead and the work goes; that is the gate.
reset role;
update campaign_briefs set brief_type = 'creative_strategy', "values" = '{"objective":"A season"}', approved_at = null, approved_by = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000cb138';   -- set up as unapproved to drive the retired machinery
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0e1'),true);
select lives_ok($$ select public.approve_department_brief('aaaaaaaa-0000-0000-0000-0000000cb138') $$, 'the Creative lead can still approve the campaign-scale brief — retired, not deleted (ADR-0100 d.6)');
reset role;
-- Taking the acceptance back, which only the database may: the stamp is fenced (ADR-0090 d.2) and
-- there is no door for un-approving. The flag is raised exactly as `approve_deliverable_tasks`
-- raises it — `reset role` alone does not open the fence, since the claims outlive the role and
-- auth.uid() still names a person. The point is to show which fact the offer hangs on.
select set_config('app.task_list_approval', 'on', true);
update deliverables set tasks_approved_at = null, tasks_approved_by = null
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1380';
select set_config('app.task_list_approval', '', true);
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a0e0'),true);
select ok(
  not exists (select 1 from public.assignable_deliverables('aaaaaaaa-0000-0000-0000-000000001380') where id = 'aaaaaaaa-0000-0000-0000-0000000d1380'),
  'and with that acceptance withdrawn the work is NOT offered, though the department brief is approved — the task list is the gate (ADR-0100 d.2)');

-- 5. Editing the master brief on the page MERGES: the fields sent win, the request record stays.
--    (Already speaking as the account manager, from the assertion above.)
select public.update_campaign_brief('aaaaaaaa-0000-0000-0000-000000001380', '{"task":"Bring people back for Season 2","proposition":"Every purchase is a ticket"}'::jsonb);
select results_eq($$
  select brief ->> 'task', brief ->> 'proposition', brief ->> 'background', brief -> 'request' ->> 'words', brief ? 'promotedJobBrief'
    from campaigns where id = 'aaaaaaaa-0000-0000-0000-000000001380'
$$, $$ values ('Bring people back for Season 2', 'Every purchase is a ticket', 'One teaser for the launch', 'One teaser for the launch', true) $$,
  'the edit replaces the fields it sends and keeps the rest — the words as asked are never lost');

select * from finish();
rollback;
