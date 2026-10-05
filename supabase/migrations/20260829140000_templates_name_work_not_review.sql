-- Workflow templates name WORK. Review is the task's own lifecycle (ADR-0052 d.1, enforced).
--
-- Edward, 29 Aug, on a Content Calendar assigned to the creative team:
--
--   "The task is to create the content calendar... arguably the Copy/Content is a task and design
--    maybe a task, however everything from Internal Review to Final is not a task, it is a step in
--    each task itself... if the list itself is already incorrect, we might as well let the user
--    define every task list themselves, which is what is being done poorly now."
--
-- He is right, and this is a SEEDING BUG rather than a design change. ADR-0052 d.1 says it plainly:
--
--   "A workflow template is a checklist of WORK TO CREATE. Nothing more. It names work —
--    'Storyboard', 'Prepress', 'Colour grade'."
--
-- "Internal Review" is not work to create. It is what happens to work after it is created, and this
-- system already models it: a task is assigned, started, submitted, reviewed by its APPOINTED
-- reviewers, and approved or sent back (ADR-0038, ADR-0043). Approving the last task is what
-- auto-approves the deliverable (ADR-0058 d.4). Putting "Internal Review" in a template creates a
-- task that itself needs an assignee, a reviewer and an approval — a review of the review.
--
-- **57 of the 154 seeded steps were lifecycle, not work.** The templates were transcribed from a
-- production-planning document, where a stage list is prose and "Client Review" is a legitimate
-- line item. Nobody reconciled that vocabulary with the task model, and a quarter of the seed
-- duplicated machinery that already existed.
--
-- WHY THIS MATTERS MORE THAN A TIDY-UP. A template that ships eight steps where two are real is
-- WORSE than no template: the person now deletes six things instead of adding two, and a system
-- that makes you undo its guesses has no reason to exist. That is the complaint, and it is fair.
--
-- ============================================================================
-- WHAT COMES OUT, AND WHAT DELIBERATELY STAYS
-- ============================================================================
-- OUT — the task lifecycle, which every task already has:
--   Internal Review · Client Review · Client Presentation · Client Approval · Approval
--   Revision · Amendments        (these are `sub_task_request_changes`, which reopens the task)
--
-- OUT — Brief. The brief exists before any of this: the wizard writes it to `campaign_briefs`
--   (ADR-0048 d.5). A task called "Brief" asks somebody to produce a thing they were handed.
--
-- OUT — bare "Final". It names the approved output, not an activity.
--
-- IN — every "Final <something>": Final Artwork, Final Master, Final Export, Final QC. Those are
--   real, distinct pieces of work, and the word "Final" in front of them is not what makes them
--   lifecycle. Same for Proof, Prepress, QA, Delivery, Archive, Installation, Scheduling.
--
-- ============================================================================
-- WHAT THIS DOES NOT FIX
-- ============================================================================
-- A task whose output cannot be uploaded — a shoot day, a print run, an installation — still
-- cannot be submitted, because `app.sub_task_submit` demands that task's own version
-- (ADR-0058 d.5). So it cannot be approved, so the deliverable never completes. That blocks the
-- PRODUCTION team, and the answer depends on how their sign-off actually works, which Edward is
-- asking them. Parked deliberately, not overlooked. The creative team is unaffected: their output
-- is a file.

begin;

create or replace function app.seed_tenant_workflow_step_corrections(p_tenant uuid) returns void
language plpgsql as $$
declare
  v_lifecycle text[] := array[
    'Brief', 'Internal Review', 'Client Review', 'Client Presentation', 'Client Approval',
    'Approval', 'Revision', 'Amendments', 'Final'
  ];
begin
  -- Only rows the SEED owns. A tenant that has deliberately added a step of its own called
  -- "Client Review" keeps it — this corrects our seeding, not their decisions (ADR-0051 d.3).
  --
  -- `sub_tasks.workflow_step_id` is `on delete set null` (20260828190000:121), so a task already
  -- materialised from one of these keeps its title and its history and simply loses the link. No
  -- work is destroyed by this, which is why it deletes rather than deactivates.
  delete from workflow_steps ws
   using workflow_templates wt
   where ws.tenant_id = p_tenant
     and wt.id = ws.template_id
     and wt.is_system
     and ws.title_en = any(v_lifecycle);

  -- Close the gaps left behind. `uq_workflow_steps_tenant_template_order` is not deferrable, so
  -- the new positions are parked out of range first and written down second — the same two-pass
  -- shape `useResequenceWorkflowSteps` uses, and for the same reason.
  with ordered as (
    select ws.id, row_number() over (partition by ws.template_id order by ws.sort_order) as n
      from workflow_steps ws
      join workflow_templates wt on wt.id = ws.template_id and wt.is_system
     where ws.tenant_id = p_tenant
  )
  update workflow_steps ws set sort_order = -ordered.n
    from ordered where ordered.id = ws.id;

  update workflow_steps ws set sort_order = -ws.sort_order
   where ws.tenant_id = p_tenant and ws.sort_order < 0;
end $$;

comment on function app.seed_tenant_workflow_step_corrections(uuid) is
  'ADR-0052 d.1 enforced: a template names WORK, and review is the task lifecycle. Removes the '
  'lifecycle steps the seed wrongly included (57 of 154) from SYSTEM templates only, and closes '
  'the ordering gaps. Idempotent. A tenant''s own steps are never touched.';

-- Existing tenants.
select app.seed_tenant_workflow_step_corrections(id) from tenants;

-- Future tenants. Reproduced from the CURRENT wrapper
-- (20260829130000_default_workflow_per_category.sql:70). This runs after the template seeder and
-- before the default-workflow mapping, so a new tenant never briefly holds the wrong list.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_brief_templates(p_tenant);
  select app.seed_tenant_deliverable_taxonomy(p_tenant);
  select app.seed_tenant_taxonomy_amendments(p_tenant);
  select app.seed_tenant_workflow_templates(p_tenant);
  select app.seed_tenant_workflow_step_corrections(p_tenant);
  select app.seed_tenant_default_workflows(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant  execute on function public.seed_tenant_roles(uuid) to service_role;

commit;
