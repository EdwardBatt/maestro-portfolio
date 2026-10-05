-- Workflow templates name WORK, not review (ADR-0052 d.1, enforced 29 Aug).
--
-- Edward, on a Content Calendar the creative team had been handed: the template gave eight steps
-- and only two were work. "Everything from Internal Review to Final is not a task, it is a step in
-- each task itself."
--
-- The assertion that carries the whole point is the second one: WF-01 Standard Digital, which is
-- what a Content Calendar resolves to, must now be exactly the two steps he named. Anything else
-- and the template is still telling somebody to do work the system already does for them.

begin;
select plan(9);
\ir helpers/seed.sql

reset role;

-- This fixture creates its tenants after the migrations ran and bypasses the provisioning wrapper,
-- so it seeds them here in wrapper order.
select app.seed_tenant_workflow_templates(id) from tenants;
select app.seed_tenant_workflow_step_corrections(id) from tenants;

-- ------------------------------------------------- the lifecycle is gone ----
select is(
  (select count(*)::int from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id and wt.is_system
    where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and ws.title_en in ('Internal Review','Client Review','Client Presentation',
                          'Client Approval','Approval','Revision','Amendments','Final','Brief')),
  0, 'no seeded template asks anybody to perform the task lifecycle as a task');

-- THE assertion. A Content Calendar maps to CNT, which defaults to WF-01.
select is(
  (select string_agg(ws.title_en, ' · ' order by ws.sort_order)
     from workflow_steps ws
     join workflow_templates wt on wt.id = ws.template_id
    where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and wt.code = 'WF-01'),
  'Copy/Content · Design',
  'WF-01 is the two steps Edward named, and nothing else');

-- ------------------------------------------------- real work survived ----
-- "Final Artwork", "Final Master", "Final QC" are work. The word "Final" in front of a noun is not
-- what makes a step lifecycle, and a regex that thought so would have gutted the print pipeline.
select is(
  (select count(*)::int from workflow_steps ws
    where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and ws.title_en in ('Final Artwork','Final Master','Final QC','Final Export')),
  6, 'every "Final <something>" survived — 6 rows across 6 templates, all real work');

select is(
  (select string_agg(ws.title_en, ' · ' order by ws.sort_order)
     from workflow_steps ws join workflow_templates wt on wt.id = ws.template_id
    where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and wt.code = 'WF-05'),
  'Copy · Design · Final Artwork · Prepress · Proof · Production · Delivery',
  'the print pipeline still reads as a production sequence');

select ok(
  (select count(*) from workflow_steps
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') between 90 and 110,
  'roughly 97 steps remain of the 154 seeded — a third were lifecycle');

-- ------------------------------------------------- ordering closed up ----
select is(
  (select count(*)::int from (
     select wt.code, ws.sort_order,
            row_number() over (partition by wt.id order by ws.sort_order) as n
       from workflow_steps ws join workflow_templates wt on wt.id = ws.template_id
      where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001') x
    where x.sort_order <> x.n),
  0, 'and every template is numbered 1..n with no gaps left by the deletions');

-- ------------------------------------------------- a tenant's own step is safe ----
-- This corrects OUR seeding, not their decisions. A tenant that deliberately wants a step called
-- "Client Review" on a template of its own keeps it.
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-0000000072b1','aaaaaaaa-0000-0000-0000-000000000001','OWN-01','Their own', false);
insert into workflow_steps (tenant_id, template_id, sort_order, title_en) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000072b1', 1, 'Client Review');

select lives_ok(
  $$select app.seed_tenant_workflow_step_corrections('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'the correction is idempotent');
select is(
  (select count(*)::int from workflow_steps
    where template_id = 'aaaaaaaa-0000-0000-0000-0000000072b1'),
  1, 'and a step on a tenant''s OWN template is never touched');

-- ------------------------------------------------- deleting a step spares the work ----
-- `sub_tasks.workflow_step_id` is `on delete set null`, which is what makes the Remove control on
-- Admin → Workflow templates safe: the plan changes, work in flight does not.
insert into deliverables (id, tenant_id, job_id, name, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000072e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','A thing','00000000-0000-0000-0000-00000000a001');
insert into sub_tasks (id, tenant_id, deliverable_id, title, workflow_step_id)
select 'aaaaaaaa-0000-0000-0000-0000000072a1','aaaaaaaa-0000-0000-0000-000000000001',
       'aaaaaaaa-0000-0000-0000-0000000072e1','Copy/Content', ws.id
  from workflow_steps ws join workflow_templates wt on wt.id = ws.template_id
 where ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
   and wt.code = 'WF-01' and ws.title_en = 'Copy/Content';

delete from workflow_steps ws using workflow_templates wt
 where wt.id = ws.template_id and wt.code = 'WF-01'
   and ws.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and ws.title_en = 'Copy/Content';

select is(
  (select title from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000072a1'),
  'Copy/Content',
  'removing a step from the template leaves the task made from it entirely intact');

select * from finish();
rollback;
