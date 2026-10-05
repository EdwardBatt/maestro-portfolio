-- I16.6 (ADR-0048 d.10) — approving a campaign tells the people who have to act on it.
--
-- **Re-decided 17 Sep (I52 Action 1, Edward):** the DELIVERABLE'S OWNER, and nobody else — not the
-- department lead by role, not reviewers. One row per deliverable, pointing at the deliverable,
-- because that is where the brief and the tasks they must review and approve live. The history
-- below (owner + lead) is kept as the record of what it was; the assertions say what it is.
--
-- **The old behaviour, asserted as the bug it was:** the notification went to appointed task
-- reviewers alone. At approval the tasks have just been materialised — unassigned, no reviewers —
-- so the query matched nothing and an approved campaign went live in silence. Edward found it by
-- asking what a deliverable manager actually receives. The answer was nothing.
--
-- Assertion 2 is the one that would have caught it: a campaign with an owner and a lead and NO
-- reviewers must still notify two people.
--
-- Subjects (helpers/seed.sql, tenant A): a001 power_admin and the account manager here; a002
-- scheduler, made the department lead; a003 team_member, the deliverable owner.

begin;
select plan(8);
\ir helpers/seed.sql

reset role;

-- a002 becomes the lead of a department, and a003 owns the deliverable in it.
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000076c1','aaaaaaaa-0000-0000-0000-000000000001','Creative 76')
on conflict do nothing;

update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000076c1',
       role_id = (select id from roles
                   where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                     and key = 'department_lead')
 where id = '00000000-0000-0000-0000-00000000a002';

-- The OWNER goes in the same department, and that is not decoration: ADR-0050 stamps a
-- deliverable's department from whoever owns it, through `tg_deliverable_stamp_department`. Setting
-- `department_id` on the insert below without this is pointless — the trigger overwrites it with
-- the owner's, which is exactly how the first version of this suite failed.
update user_profiles set department_id = 'aaaaaaaa-0000-0000-0000-0000000076c1'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000076e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Campaign 76','pending_approval',
   '00000000-0000-0000-0000-00000000a001');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000076f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076e1','Campaign 76');

-- The shape at the moment of approval: a deliverable with an OWNER and a department, holding a task
-- that is unassigned and has no reviewer. This is what a wizard-created campaign looks like, and it
-- is precisely the shape the old query returned nothing for.
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000076d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076f1','Hero film','draft',
   '00000000-0000-0000-0000-00000000a003','aaaaaaaa-0000-0000-0000-0000000076c1');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000076a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076d1','Edit','todo');

select is(
  (select count(*)::int from sub_task_reviewers r
     join sub_tasks t on t.id = r.sub_task_id
    where t.deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000076d1'),
  0, 'no reviewer is appointed yet — the ordinary state of a campaign about to be approved');

-- ========================================= 2-5. who is told ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok($$select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000076e1')$$,
  'the account manager approves it');

reset role;

-- THE assertion. Two people with no reviewer between them. The old query notified nobody at all.
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e1'),
  1, 'ONE person is told — the deliverable owner; the row points at the campaign (I52 Action 1, I53.19)');

select ok(
  exists (select 1 from notifications
           where type = 'campaign_approved'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e1'
             and user_id = '00000000-0000-0000-0000-00000000a003'),
  'the DELIVERABLE OWNER is told — the person accountable for the thing (ADR-0050)');

select ok(
  not exists (select 1 from notifications
           where type = 'campaign_approved'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e1'
             and user_id = '00000000-0000-0000-0000-00000000a002'),
  'the DEPARTMENT LEAD is NOT told by role — the owner is the one with something to do (I52 Action 1)');

-- The approver already knows; telling them is noise, and noise is what teaches people to ignore
-- the channel.
select ok(
  not exists (select 1 from notifications
               where type = 'campaign_approved'
                 and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e1'
                 and user_id = '00000000-0000-0000-0000-00000000a001'),
  'the account manager is not told about their own approval');

-- ============================ 6-7. reviewers are kept, and nobody is told twice ====
-- A campaign approved after work HAS been appointed should still tell the reviewer. And somebody
-- who is both an owner and a reviewer gets one notification, not two — `distinct` across the union.
reset role;
insert into campaigns (id, tenant_id, client_id, name, status, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-0000000076e2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001','Campaign 76b','pending_approval',
   '00000000-0000-0000-0000-00000000a001');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000076f2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076e2','Campaign 76b');
insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, department_id, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000076d2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076f2','Cutdowns','draft',
   '00000000-0000-0000-0000-00000000a002','aaaaaaaa-0000-0000-0000-0000000076c1','2026-10-01 15:00+00');
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000076a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000076d2','Edit 2','todo','00000000-0000-0000-0000-00000000a003', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000076a2',
   '00000000-0000-0000-0000-00000000a002');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select public.approve_campaign('aaaaaaaa-0000-0000-0000-0000000076e2');

reset role;
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e2'),
  1,
  'a002 is the owner, the lead AND the reviewer here — and is told exactly once, as the owner');

select ok(
  exists (select 1 from notifications
           where type = 'campaign_approved'
             and entity_id = 'aaaaaaaa-0000-0000-0000-0000000076e2'
             and user_id = '00000000-0000-0000-0000-00000000a002'),
  'and it is them');

select * from finish();
rollback;
