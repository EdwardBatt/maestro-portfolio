-- I25.4 (ADR-0058 d.6) — a deliverable approves itself when its last task does.
--
-- Edward, 28 Aug: *"if all sub-tasks are approved, then the deliverable by default is approved."*
--
-- **This was already written.** `app.maybe_complete_sub_task` has set the deliverable to `approved`
-- when the last sub-task completes since ADR-0043 — fenced by `v_stream is null` to ad-hoc work.
-- Its own comment even anticipates the general case: *"belt-and-braces for a job-backed deliverable
-- that somehow holds more than one task: the last approval carries it."* It was simply switched off
-- for the case that needed it.
--
-- One condition removed. Ad-hoc is unchanged and is the reference implementation: it has been
-- running this model in production the whole time.
--
-- The transition guard is untouched and now AGREES with this rather than only one of them being
-- reachable — it already refuses `approved` while any task is unsettled, which is the same rule
-- read from the other end.
--
-- Reproduced from `20260827100000`, the current definition, with that single edit.

begin;

create or replace function app.maybe_complete_sub_task(p_sub_task uuid, p_actor uuid default null)
returns boolean language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks;
  v_stream uuid;
  v_state  deliverable_state;
  v_by     uuid;
begin
  -- FOR UPDATE, and it is the whole defence against a lost update. Two mandatory reviewers
  -- approving at the same moment each stamped their own row and then counted the other as
  -- outstanding — neither can see the other's uncommitted stamp under READ COMMITTED — so both
  -- returned "not yet", leaving the task with every approval given, status `review` and
  -- approved_by null, and unable to be approved again by anybody. Serialising per task is what
  -- makes the count taken after the stamp mean what it says.
  select * into v from sub_tasks where id = p_sub_task for update;
  if not found or v.status <> 'review' then
    return false;
  end if;

  -- Nobody has agreed to anything yet. This matters on the appointment-change path: removing one of
  -- two optional reviewers when neither has approved must not complete the task by arithmetic.
  if not exists (select 1 from sub_task_reviewers r
                  where r.sub_task_id = p_sub_task and r.approved_at is not null) then
    return false;
  end if;

  -- ADR-0043 d.5. With mandatory reviewers the task completes when the LAST of them agrees; with
  -- none marked mandatory the first approval completes it (the pool behaviour, and the behaviour of
  -- every task that has exactly one reviewer).
  if exists (select 1 from sub_task_reviewers r
              where r.sub_task_id = p_sub_task and r.is_mandatory and r.approved_at is null) then
    return false;
  end if;

  -- Who completed it. The caller when there is one; otherwise the reviewer whose verdict turned out
  -- to be the last one needed, which is the honest answer when an appointment change carried it.
  v_by := coalesce(p_actor, (
    select r.user_id from sub_task_reviewers r
     where r.sub_task_id = p_sub_task and r.approved_at is not null
     order by r.approved_at desc, r.created_at desc, r.user_id desc
     limit 1));

  update sub_tasks
     set status      = 'done',
         approved_by = v_by,
         approved_at = now()
   where id = p_sub_task;

  -- Tell the maker their work was accepted. Best-effort by convention: the row is the record.
  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'signed_off', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- An AD-HOC deliverable (stream_id null) is this one piece of work, so approving its task is the
  -- sign-off. A CAMPAIGN deliverable holds several tasks and is signed off by whoever owns it —
  -- never as a side effect of one task (ADR-0038: "tasks are approved, deliverables are signed off").
  -- The `not exists` is belt-and-braces for a job-backed deliverable that somehow holds more than
  -- one task: the last approval carries it, an earlier one does not.
  select d.stream_id, d.state into v_stream, v_state
    from deliverables d where d.id = v.deliverable_id;

  -- ADR-0058 d.6 (I25.4): `v_stream is null` used to stand here, fencing this to AD-HOC work only.
  -- A campaign deliverable was excluded, so somebody had to drive by hand a transition the system
  -- had already decided — while the guard beneath refused that same transition until every task was
  -- settled. The two halves could not both be reached. Removing the condition makes campaign work
  -- behave the way ad-hoc already does, which is the whole of "the deliverable is a container": it
  -- is approved as a CONSEQUENCE of the work beneath it, never as an act performed on it.
  if v_state = 'in_review'
     and not exists (
       select 1 from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('done', 'cancelled')
     )
  then
    -- Deliberately NOT swallowed. A silent best-effort here is what let the 25 Aug regression ship.
    --
    -- KNOWN EDGE, ACCEPTED: the deliverable guard demands reviews:moderate of the CALLER, and on the
    -- appointment-change path the caller is whoever manages the task, who need not hold it (a
    -- Traffic Manager does not). So removing the last mandatory reviewer from an AD-HOC task whose
    -- optional reviewer has already approved can be refused with the guard's own 42501. Narrow —
    -- ad-hoc work is created single-reviewer — and it is the honest failure: the alternative is a
    -- task marked done with its deliverable stranded in_review, which is exactly what
    -- 20260825120000 had to repair. Flagged for Edward rather than papered over.
    update deliverables set state = 'approved' where id = v.deliverable_id;
  end if;

  return true;
end $$;

comment on function app.maybe_complete_sub_task(uuid, uuid) is
  'ADR-0043 d.5, amended by ADR-0058 d.6: complete a task in review IF every mandatory reviewer has '
  'approved (or none is mandatory and somebody has), and carry the DELIVERABLE to approved when it '
  'was the last one outstanding. No longer fenced to ad-hoc work: a campaign deliverable is a '
  'container and is approved as a consequence of the work beneath it, exactly as ad-hoc already was.';

commit;
