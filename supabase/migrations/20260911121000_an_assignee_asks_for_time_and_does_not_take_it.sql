-- ADR-0088 d.11 / I46.2 — the side door closes: an assignee cannot move their own dates.
--
-- `sub_tasks_manage_update` (20260819100000) carries `or assignee_id = auth.uid()` so a maker can
-- progress their own task — Start, Submit, the timer. It fences no columns, and `public.save_sub_task`
-- is security invoker with no gate of its own. So an assignee calling it with `p_due_at`, or issuing
-- a bare PostgREST `update sub_tasks set due_at`, moved their own deadline today: no booking moved,
-- nobody was told, and the next booking write silently put it back. No screen offers this. It is
-- the person with the strongest motive holding the exact write ADR-0075 exists to make honest.
--
-- CLOSED HERE, IN THE DATABASE, in the shape of `app.tg_sub_task_completion_guard` (20260827100000):
-- one trigger that polices one thing and escapes on `app.system_op`. The policy is left as it is —
-- the branch is right for what it was written for, and narrowing it to a column list would break
-- the moment the next status-like column arrives. What is refused is a change of `starts_at` or
-- `due_at` by an actor who is on the row ONLY as its assignee. Somebody who is the assignee AND holds
-- the reschedule authority (a lead who gave themselves the work, an account manager on their own
-- campaign) passes, exactly as they pass the policy's first branch.
--
-- THE SPAN SYNC PASSES. `app.sync_subtask_span` rewrites the task's dates from its bookings
-- (ADR-0039) from inside the bookings trigger. That write already passed the bookings gate, and it
-- is the plan following the calendar — not the side door. `pg_trigger_depth() > 1` is that case
-- and nothing else that touches these columns.
--
-- The committed_* columns need no second fence: 20260911120000 refuses every write to them that is
-- not the stamp or the extension RPC, whoever the actor is.
--
-- `sla_hours` IS fenced too, though ADR-0088 d.11 named only the two dates. The independent
-- review (11 Sep) showed the assignee could still write it — by bare update and through
-- `save_sub_task(p_sla_hours)` — and it is the numerator of ADR-0075 d.4's at-risk arithmetic: the
-- maker could silence "at risk" on their own row by shrinking the estimate. Same door, same shape;
-- recorded as an addendum on ADR-0088.
--
-- ADR-0088 d.11's other half — "the assignee keeps everything the branch was written for" — is
-- asserted rather than assumed: the paired suite proves Start and Submit still work after this.
--
-- Tests: supabase/tests/100_an_assignee_asks_for_time_and_does_not_take_it.sql

begin;

create or replace function app.tg_sub_task_assignee_date_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or app.is_system_op() then
    return new;                          -- migrations, seeders, system paths
  end if;
  if pg_trigger_depth() > 1 then
    return new;                          -- the span sync from bookings (ADR-0039)
  end if;
  if old.assignee_id is distinct from v_actor then
    return new;                          -- not the own-row branch; the policy decided
  end if;
  if new.starts_at is not distinct from old.starts_at
     and new.due_at is not distinct from old.due_at
     and new.sla_hours is not distinct from old.sla_hours then
    return new;                          -- progressing the task, not moving or resizing it
  end if;
  -- The assignee, moving their own dates. Allowed only if they are ALSO here by authority.
  if (app.has_permission('project_tasks', 'manage')
      and app.in_write_scope(old.department_id, old.team_id,
                             app.deliverable_account_manager(old.deliverable_id)))
     or app.caller_is_project_pm(old.deliverable_id) then
    return new;
  end if;
  raise exception
    'the deadline of your own task is changed by asking for an extension, not by editing it'
    using errcode = '42501';
end $$;

comment on function app.tg_sub_task_assignee_date_fence() is
  'ADR-0088 d.11 / I46.2: refuses a change of starts_at, due_at or sla_hours by an actor who is '
  'on the row only as its assignee. Escapes for system ops, for the bookings span sync, and for an assignee '
  'who also holds the reschedule authority.';

create trigger sub_task_assignee_date_fence
  before update of starts_at, due_at, sla_hours on sub_tasks
  for each row execute function app.tg_sub_task_assignee_date_fence();

commit;
