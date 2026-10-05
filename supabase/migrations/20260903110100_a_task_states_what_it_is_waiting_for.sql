-- I36.3 / I36.5 (ADR-0069 d.2, d.4) — a requirement is met on APPROVAL, and clearing the last one
-- tells whoever was waiting.
--
-- WHAT ALREADY EXISTED, AND HAS NEVER BEEN USED. `sub_task_dependencies` (B depends on A,
-- many-to-many, cross-deliverable, cycle-guarded) and `deliverable_pending_inputs` (specific
-- external items) were built in August under ADR-0030 (I8.3), and outside the generated
-- `database.ts` the frontend has never referenced either. Nothing here changes their shape. What
-- changes is WHEN a dependency counts as met, and what happens at the moment it does.
--
-- ---------------------------------------------------------------------------------------------
-- 1. SATISFIED ON APPROVE, NOT ON SUBMIT (d.2 — the one amendment to ADR-0030 §1b).
--
-- The old predicate accepted `('review', 'done', 'cancelled')`, so a task sitting in review — work
-- handed over but not yet accepted — released everything waiting on it. That is exactly the case
-- the feature exists to prevent: the next person starts on output that is about to be sent back,
-- and the rework is invisible because nothing recorded that they started too early.
--
-- `cancelled` still satisfies, deliberately. A prerequisite that will never happen must not hold
-- its dependent for ever; the alternative is a task that can only be freed by editing the
-- dependency, which nobody would think to do.
--
-- ---------------------------------------------------------------------------------------------
-- 2. STILL SOFT (d.3, reaffirmed). Nothing below gates anything. `app.sub_task_start` keeps
-- calling this predicate to set `started_ahead`, and moving satisfaction later makes that flag
-- FIRE MORE OFTEN, which is the honest consequence: work picked up between submission and approval
-- genuinely was started ahead. Edward asked for hard blocking, then kept the soft rule on being
-- reminded why it exists — a blocked flag becomes the reason work did not happen, and
-- `started_ahead` only exists while pressing on is possible.
--
-- ---------------------------------------------------------------------------------------------
-- 3. A TRIGGER, NOT AN EDIT TO `maybe_complete_sub_task`. Approval is not the only route to
-- `done` — the appointment-change path completes a task too, and a future one might — so this
-- hangs off the STATUS REACHING `done` rather than off one function that happens to set it. It
-- also avoids reproducing a 90-line function whole, which the house pattern would otherwise
-- require (a bare `create or replace` resets `proconfig` and drops the ADR-0033 `search_path` pin).

begin;

-- ------------------------------------------------------------ the predicate, amended ----
create or replace function app.sub_task_has_unmet_prereqs(p_sub_task uuid)
returns boolean language sql stable set search_path = public, app as $$
  select exists (
    select 1 from sub_task_dependencies dep
    join sub_tasks a on a.id = dep.depends_on_sub_task_id
    -- ADR-0069 d.2: `review` no longer satisfies. Only accepted work, or work that will never
    -- happen, releases what is waiting on it.
    where dep.sub_task_id = p_sub_task and a.status not in ('done', 'cancelled')
  ) or exists (
    select 1 from deliverable_pending_inputs pin
    join sub_tasks st on st.deliverable_id = pin.deliverable_id
    where st.id = p_sub_task and pin.satisfied_at is null
  )
$$;

comment on function app.sub_task_has_unmet_prereqs(uuid) is
  'ADR-0030 as amended by ADR-0069 d.2: true if the sub-task has a dependency not yet APPROVED '
  '(was: not yet submitted) OR its deliverable has an outstanding external input. Still SOFT — '
  'never gates; drives the started_ahead flag, which now fires more often, correctly.';

-- --------------------------------------------------- telling whoever was waiting (d.4) ----
-- Every assignee whose task was waiting on `p_sub_task` and has NOTHING outstanding any more.
--
-- The `not has_unmet_prereqs` re-check is the whole point: a task with three requirements must
-- produce ONE message, when the last clears, not one per prerequisite. ADR-0045's standing warning
-- is that a reminder arriving about something the recipient cannot act on trains people to ignore
-- an inbox that also carries changes_requested — so "you can start now" has to be TRUE when it
-- arrives, not merely closer to true.
create or replace function app.notify_dependents_ready(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select b.tenant_id, b.assignee_id, 'dependency_ready', b.title, 'sub_task', b.id, auth.uid()
    from sub_task_dependencies dep
    join sub_tasks b on b.id = dep.sub_task_id
   where dep.depends_on_sub_task_id = p_sub_task
     and b.assignee_id is not null
     -- Nobody is told to start work that is finished, cancelled, or already under way.
     and b.status = 'todo'
     -- Never to the person who just did the approving; they know.
     and b.assignee_id is distinct from auth.uid()
     and not app.sub_task_has_unmet_prereqs(b.id);
end $$;

comment on function app.notify_dependents_ready(uuid) is
  'ADR-0069 d.4: when a task is approved, tell every waiting assignee whose LAST requirement has '
  'just cleared. One message for three prerequisites, not three — "you can start now" must be true '
  'when it arrives.';

revoke execute on function app.notify_dependents_ready(uuid) from public;
grant  execute on function app.notify_dependents_ready(uuid) to authenticated;

-- ------------------------------------------------------- fired by REACHING done, not by ----
-- ------------------------------------------------------- one function that happens to set it ----
create or replace function app.tg_sub_task_dependents_ready()
returns trigger language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform app.notify_dependents_ready(new.id);
  end if;
  return null;
end $$;

comment on function app.tg_sub_task_dependents_ready() is
  'ADR-0069 d.4. Hangs off the STATUS, not off sub_task_approve: the appointment-change path also '
  'completes a task (app.maybe_complete_sub_task), and a route added later would otherwise be a '
  'silent gap. Cancelling a prerequisite also frees its dependents and deliberately does NOT '
  'notify — d.4 is about approval; see the tracker entry.';

drop trigger if exists sub_task_dependents_ready on sub_tasks;
create trigger sub_task_dependents_ready
  after update of status on sub_tasks
  for each row execute function app.tg_sub_task_dependents_ready();

commit;
