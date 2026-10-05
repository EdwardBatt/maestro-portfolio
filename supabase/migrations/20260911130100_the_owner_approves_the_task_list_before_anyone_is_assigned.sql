-- I44 (ADR-0090) — the owner approves the task list before anyone is assigned.
--
-- THE GAP. A campaign's work is gated twice before assignment: the account manager approves the
-- campaign (ADR-0048 d.8), and the department accepts its own brief (ADR-0070 d.4). For a single
-- job the second gate is passed BY the account manager — ADR-0084 d.4 approves the single-execution
-- brief with the job, on SJ-04 — so nothing department-side remained, and a single job's tasks
-- would have been assignable the instant it was released with nobody who owns the work having
-- said "this is the list". Edward's step — the deliverable owner reviews, edits and approves the
-- generated list — is the single job's equivalent of the department's acceptance. Not a third
-- gate; the second one, in the shape a single job needs.
--
-- "HELD" NEEDS NO NEW STATUS (d.1). Tasks are generated where they always were — on deliverable
-- insert, by `tg_deliverable_materialise_workflow` — and an unassigned `todo` task is already held:
-- it consumes no capacity and sits on nobody's My Work. Two columns on the deliverable say whether
-- the owner has approved the list; one condition in the trigger every assignment already passes
-- refuses until they have.
--
-- WHY THE BRANCH IS ON `kind`, AND WHY THE ADR'S WORDING COULD NOT BE BUILT LITERALLY. ADR-0090
-- d.6 asks for the second check to be written as "has the department accepted this work?",
-- answered by `sub_task_brief_is_approved` *where the campaign has department briefs* and by
-- `tasks_approved_at` where it does not — "rather than as a kind branch". But ADR-0084 d.3 stores
-- the single-execution brief IN `campaign_briefs`, with the department from SJ-02, so a single job
-- DOES have a campaign_briefs row for its department, and "has department briefs" is true of it.
-- Read literally, the ADR's condition would route every single job to the brief check — which
-- passes at release — and the gate this migration exists to add would never fire. The other
-- reading ("has a brief generated under ADR-0072", i.e. not single_execution) would change the
-- CAMPAIGN gate: a campaign deliverable whose department has not generated a brief yet passes
-- today (ADR-0070 d.5, absence is not refusal) and would start being refused until a task list
-- was approved — exactly what d.6's "nothing about the campaign flow the pilot runs today changes"
-- forbids. `campaigns.kind` is the stored fact ADR-0086 d.8 created so that this is never inferred
-- from which rows happen to exist, so it is what the branch reads. The behaviour d.6 specifies —
-- campaigns keep the gate they have, byte for byte; single jobs answer with the owner's approval —
-- is what is built. The trigger's comment says the same, per d.6's own instruction.
--
-- A PROMOTED JOB (ADR-0086 d.10) becomes `kind = 'campaign'` and from that moment answers the
-- campaign way: its single-execution brief is approved (stamped at release) so its original
-- deliverable's work is assignable whether or not the owner had approved the list. Accepted edge,
-- noted rather than special-cased — the person promoting is the account manager, the work is
-- now a campaign's, and the departments added by the wizard gate their own under ADR-0070.
--
-- THE RPC IS SECURITY DEFINER, authorised by ADR-0090 d.4: the owner of record may approve their
-- own list whether or not they hold `project_tasks:manage`, so the write cannot go through
-- `deliverables_tenant_write`. Authority is decided in the body, from the ROW and from GRANTS —
-- `owner_user_id`, or `deliverable_owner:manage` within `in_write_scope` of the deliverable's
-- department — never from a role name (ADR-0073/0074). The same shape as `approve_department_brief`
-- and `approve_campaign`. The two columns it writes are fixed by its body; nothing else is touched.
--
-- `tg_sub_task_assignment_gate` is reproduced WHOLE from `20260903130000`, its last definition
-- (ADR-0070 d.4), with the second check widened. The first check and the escapes are byte-identical.

begin;

-- ---------------------------------------------------------------- the stamp ----
alter table deliverables
  add column if not exists tasks_approved_at timestamptz,
  add column if not exists tasks_approved_by uuid references user_profiles(id);

comment on column deliverables.tasks_approved_at is
  'ADR-0090 d.2: when the deliverable''s owner approved its generated task list. NULL is '
  'unapproved — the absence of a timestamp, the way campaigns.approved_at and '
  'campaign_briefs.approved_at do it. On a SINGLE JOB nothing under this deliverable can be '
  'assigned until it is set (d.3); a campaign deliverable is gated by its department brief '
  'instead (d.6) and this column is informational there. A gate, not a lock (d.5): the list stays '
  'editable afterwards.';

comment on column deliverables.tasks_approved_by is
  'ADR-0090 d.2: who approved the list. Stamped from auth.uid() by approve_deliverable_tasks, '
  'never sent by a caller.';

-- The "awaiting the owner's review" line on the unassigned surfaces (d.3b) reads the unapproved
-- ones. Partial: an approved deliverable is not in it.
create index if not exists idx_deliverables_tasks_awaiting
  on deliverables (tenant_id, owner_user_id)
  where tasks_approved_at is null;

-- ---------------------------------------------------------------- approving ----
create or replace function public.approve_deliverable_tasks(p_deliverable uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v deliverables;
begin
  select * into v from deliverables
   where id = p_deliverable and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;

  -- Idempotent (d.4). The FIRST approval is the fact; a second press must not move the timestamp.
  if v.tasks_approved_at is not null then
    return;
  end if;

  -- d.4: the owner of record, or the person who could have changed the owner — anyone holding
  -- deliverable_owner:manage within scope of the deliverable's department (a team lead in that
  -- department passes on the team branch of in_write_scope; Power Admin and Traffic Manager pass
  -- by being tenant-scoped, which is the failsafe for an absent owner). Computed from the row and
  -- from grants; no role is named.
  if not (
       (v.owner_user_id is not null and v.owner_user_id = auth.uid())
    or (app.has_permission('deliverable_owner', 'manage')
        and app.in_write_scope(v.department_id, null, null))
  ) then
    raise exception 'only the owner of this deliverable, or someone who may change its owner, can approve its task list'
      using errcode = '42501';
  end if;

  update deliverables
     set tasks_approved_at = now(),
         tasks_approved_by = auth.uid()
   where id = p_deliverable;
end $$;

comment on function public.approve_deliverable_tasks(uuid) is
  'ADR-0090 d.4: the deliverable''s owner says "this is the list", which on a single job is what '
  'opens assignment. Authority: owner_user_id, or deliverable_owner:manage within in_write_scope '
  'of the deliverable''s department. SECURITY DEFINER because an owner need not hold '
  'project_tasks:manage; the body fixes the two columns it may touch. Idempotent — the first '
  'timestamp stands.';

revoke execute on function public.approve_deliverable_tasks(uuid) from public;
revoke execute on function public.approve_deliverable_tasks(uuid) from anon;
grant  execute on function public.approve_deliverable_tasks(uuid) to authenticated;

-- ---------------------------------------------------------------- the gate ----
-- Has the department accepted this work? Two answers by kind of job (ADR-0090 d.6):
--   campaign    the department approved its brief — app.sub_task_brief_is_approved, UNCHANGED,
--               including its "absence is not refusal" rule (ADR-0070 d.5);
--   single_job  the deliverable's owner approved its task list — tasks_approved_at is set.
-- Ad-hoc work (no campaign) is not governed by this gate at all and answers true, as it does for
-- the campaign-approval check above it.
--
-- Returns NULL when the work is accepted; otherwise the refusal message, already naming the
-- deliverable and its owner — so the trigger raises the sentence rather than composing it.
create or replace function app.sub_task_work_acceptance_refusal(p_sub_task uuid) returns text
language sql stable security definer
set search_path = public, app, extensions as $$
  select case
    when c.id is null then null
    when c.kind = 'single_job' then
      case when d.tasks_approved_at is not null then null
           else format('the task list for "%s" has not been approved by %s yet, so its work cannot be assigned',
                       d.name, coalesce(own.display_name, 'its owner'))
      end
    else
      case when app.sub_task_brief_is_approved(p_sub_task) then null
           else 'this department has not approved its brief yet, so its work cannot be assigned'
      end
  end
  from sub_tasks st
  join deliverables d on d.id = st.deliverable_id
  left join streams s on s.id = d.stream_id
  left join campaigns c on c.id = s.campaign_id
  left join user_profiles own on own.id = d.owner_user_id
  where st.id = p_sub_task;
$$;

comment on function app.sub_task_work_acceptance_refusal(uuid) is
  'ADR-0090 d.6: "has the department accepted this work?" — NULL when yes, else the refusal. A '
  'campaign answers with its department brief (ADR-0070 d.4, unchanged); a single job answers '
  'with deliverables.tasks_approved_at, naming the deliverable and its owner. Branches on '
  'campaigns.kind because ADR-0084 d.3 stores the single-execution brief in campaign_briefs, so '
  '"has department briefs" is true of a single job too and cannot tell the two apart.';

-- Reproduced whole from `20260903130000`. The first check and both escapes are byte-identical;
-- the second check now asks app.sub_task_work_acceptance_refusal instead of
-- app.sub_task_brief_is_approved directly.
create or replace function app.tg_sub_task_assignment_gate() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_campaign uuid; v_refusal text;
begin
  -- Only an ASSIGNMENT is gated. A pending campaign's tasks can still be created, renamed and
  -- re-dated while the account manager reads them — that is what reviewing is.
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  -- Migrations and seeders escape, the same way ADR-0040's assignment trigger lets them.
  if auth.uid() is null or app.is_system_op() then return new; end if;

  v_campaign := app.sub_task_campaign(new.id);
  if not app.campaign_is_approved(v_campaign) then
    raise exception
      'this campaign is waiting for the account manager to approve it, so its work cannot be assigned yet'
      using errcode = '42501';
  end if;

  -- The second stage: has the department accepted this work? ADR-0070 d.4 for a campaign (its
  -- brief), ADR-0090 d.3/d.6 for a single job (its owner's task-list approval). See the comment on
  -- the function for why it branches on kind.
  v_refusal := app.sub_task_work_acceptance_refusal(new.id);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_sub_task_assignment_gate() is
  'ADR-0048 d.8 + ADR-0070 d.4 + ADR-0090 d.3/d.6. Two gates before an assignment: the account '
  'manager approved the campaign, and the department accepted the work. The second has two '
  'answers by campaigns.kind — a CAMPAIGN''s department approves its brief (unchanged, absence is '
  'not refusal); a SINGLE JOB''s brief is approved by the account manager at release (ADR-0084 '
  'd.4), so its department accepts by its deliverable OWNER approving the generated task list '
  '(deliverables.tasks_approved_at). Single jobs only in effect; nothing about the campaign flow '
  'changes. Migrations and system operations pass.';

commit;
