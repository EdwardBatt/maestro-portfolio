-- Approving the task signs off an ad-hoc deliverable again (regression fix).
--
-- WHAT BROKE. ADR-0038 moved approval to the TASK: public.sub_task_approve sets the task to 'done'
-- and stamps approved_by/approved_at. Before that, the reviewer inbox approved the DELIVERABLE
-- (in_review → approved). When the panel was changed on 24 Aug to approve the task — correctly, because
-- the old version required the deliverable to be in_review, a state only ad-hoc work ever reached, so
-- campaign tasks arrived with Approve permanently greyed out — the other half was not put back.
--
-- Result: the reviewer approves, the task goes to 'done', and the deliverable stays in_review
-- forever. Nothing else advances it: every automatic write to deliverables.state in the whole
-- migration history moves it BACKWARDS to in_progress (request-changes). The /deliverables Ad-hoc tab
-- lists state = 'approved', so approved ad-hoc work simply never appeared. Reported from live use.
--
-- THE SHAPE OF THE FIX is already established on the submit side, and this is its mirror. MyWorkPanel
-- advances an ad-hoc deliverable in_progress → in_review when its task is submitted, with the reason
-- written next to it: an ad-hoc deliverable IS its one task, so the task's progress is the
-- deliverable's; a campaign deliverable holds several, so one task must never move it. Approval now
-- follows the same rule.
--
-- IT LIVES IN THE RPC, NOT THE PANEL. The submit-side equivalent is a best-effort client call, which
-- is why nobody noticed when the approve-side one went missing. Putting it server-side means every
-- path that approves a task — this panel, a future one, a script — carries it (AGENTS.md §2).
--
-- search_path pinned inline per ADR-0033.

begin;

-- ============================================================================
-- 1) approving the last task signs off an ad-hoc deliverable
-- ============================================================================
-- Reproduced from 20260824140000 with one block added at the end. Everything above it is unchanged.
create or replace function public.sub_task_approve(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status <> 'review' then
    raise exception 'task cannot be approved from % (only a submitted task can be approved)', v.status
      using errcode = '22023';
  end if;

  -- THIS task's reviewer, not the deliverable's owner and not any moderator at large (ADR-0038 d.3).
  if v.reviewer_id is distinct from auth.uid() then
    raise exception 'only the appointed reviewer may approve this task' using errcode = '42501';
  end if;

  update sub_tasks
     set status      = 'done',
         approved_by = auth.uid(),
         approved_at = now()
   where id = p_sub_task;

  -- Tell the maker their work was accepted. Best-effort by convention: the row is the record.
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'signed_off', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- ------------------------------------------------------------------ NEW ----
  -- An AD-HOC deliverable (stream_id null) is this one piece of work, so approving its task is the
  -- sign-off. A CAMPAIGN deliverable holds several tasks and is signed off by whoever owns it —
  -- never as a side effect of one task (ADR-0038: "tasks are approved, deliverables are signed off").
  -- The `not exists` is belt-and-braces for a job-backed deliverable that somehow holds more than
  -- one task: the last approval carries it, an earlier one does not.
  select d.stream_id, d.state into v_stream, v_state
    from deliverables d where d.id = v.deliverable_id;

  if v_stream is null and v_state = 'in_review'
     and not exists (
       select 1 from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('done', 'cancelled')
     )
  then
    -- Deliberately NOT swallowed. The transition guard requires reviews:moderate for sign-off, and
    -- ADR-0038 already requires an appointed reviewer to hold it (update_task_assignment checks
    -- app.user_holds_permission before accepting one), so a refusal here means something is wrong
    -- and should be seen. A silent best-effort is what let this regression ship unnoticed.
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;
end $$;

comment on function public.sub_task_approve(uuid) is
  'ADR-0038: the appointed reviewer approves a submitted task (review → done), stamping approved_by '
  'and approved_at. For an AD-HOC deliverable (stream_id null) approving the last live task also '
  'signs the deliverable off (in_review → approved) — the mirror of the submit path advancing it to '
  'in_review. A campaign deliverable is never moved by one task.';
revoke execute on function public.sub_task_approve(uuid) from public;
revoke execute on function public.sub_task_approve(uuid) from anon;
grant  execute on function public.sub_task_approve(uuid) to authenticated;

-- ============================================================================
-- 2) repair the work already stranded by this
-- ============================================================================
-- Every ad-hoc deliverable whose tasks are all finished and at least one was actually APPROVED by a
-- reviewer, but which is still sitting in in_review. The reviewer's decision was made and recorded on
-- the task (approved_by / approved_at); only the deliverable failed to follow. This applies that
-- decision — it does not make one.
--
-- approved_by IS the evidence: without it a task reached 'done' some other way and is left alone.
--
-- The guard trigger is disabled for this statement only: it demands reviews:moderate of the CALLER,
-- and a migration has no auth.uid(). Transactional, so it is restored on commit or rollback either
-- way.
-- deliverable_notify is disabled too. sub_task_approve ALREADY told each assignee their work was
-- accepted, at the time they were told; letting the state change fire a second 'signed_off' would
-- notify everyone again, days later, for a decision they have already seen. The notification for
-- these was not missed — only the state change was.
alter table deliverables disable trigger deliverable_transition_guard;
alter table deliverables disable trigger deliverable_notify;

do $$
declare v_n int;
begin
  with repairable as (
    select d.id
    from deliverables d
    where d.stream_id is null
      and d.state = 'in_review'
      and exists (select 1 from sub_tasks st
                  where st.deliverable_id = d.id and st.approved_by is not null)
      and not exists (select 1 from sub_tasks st
                      where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
  )
  update deliverables d set state = 'approved'
  from repairable r where d.id = r.id;
  get diagnostics v_n = row_count;
  raise notice 'adhoc sign-off repair: % deliverable(s) moved in_review -> approved', v_n;
end $$;

alter table deliverables enable trigger deliverable_transition_guard;
alter table deliverables enable trigger deliverable_notify;

-- KNOWN AND ACCEPTED: bypassing the guard also skips the sla_event it writes on sign-off, so these
-- repaired deliverables carry no deliverable-level SLA event for the approval. The decision itself is
-- not lost — it is stamped on the task as approved_by/approved_at, which is where ADR-0038 puts the
-- record. Synthesising events with invented timestamps would be worse than the gap.

commit;
