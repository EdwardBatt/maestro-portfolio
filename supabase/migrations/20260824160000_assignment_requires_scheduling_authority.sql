-- ADR-0040 (I12.5): assigning work requires the authority to schedule it.
--
-- THE DEFECT. Assigning ad-hoc work is gated twice, in two places, with a COMMIT in between:
--
--   create_adhoc_deliverable  →  project_tasks:manage + in_write_scope(department, team)
--                                 "may you assign work here?"
--   subtask-schedule          →  bookings:create + resource_in_write_scope(resource)
--                                 "may you book that person's calendar?"
--
-- Independent permissions over independent objects, so passing the first and failing the second is
-- an ordinary outcome — and the task is already committed by then. The assignment half-succeeds:
-- work owed by somebody whose calendar the assigner was never allowed to touch, on no grid,
-- consuming no capacity, visible only to the assignee. On 23 Aug that produced SIX identical tasks
-- for one piece of work: the operator saw an error, retried, and every retry committed another.
--
-- I12.3 stopped the retry loop. This stops the half-success itself, by asking BOTH questions before
-- anything is written.
--
-- WHY A TRIGGER AND NOT A CHECK IN THE RPC. The campaign form inserts sub_tasks directly, and
-- update_task_assignment is a third path. Gating one RPC is exactly how the two-gate split arose.
-- Postgres owns the invariant (AGENTS.md §2), so every path — present or future — carries it.
--
-- WHAT THIS WILL BREAK, DELIBERATELY. account_manager holds project_tasks:manage but NOT
-- bookings:create (measured in L6.9), so every ad-hoc assignment it makes half-succeeds today. After
-- this it is refused outright, immediately, with the real reason. That is an honest failure
-- replacing a silent one, and the fix is a grant rather than a code change — see ADR-0040.
--
-- search_path pinned inline per ADR-0033.

begin;

create or replace function app.tg_subtask_assignment_authority() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_resource uuid;
begin
  -- Only when work is being GIVEN to someone. Unassigning needs no booking authority (ADR-0040 d.4).
  if new.assignee_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.assignee_id is not distinct from new.assignee_id then
    return new;
  end if;

  -- Seeders, migrations and service contexts. auth.uid() is null for anything not acting as a
  -- signed-in user, which is already how RLS treats those callers — a data migration must not be
  -- blocked by a permission the migration role has no business holding (ADR-0040 d.5).
  if auth.uid() is null or coalesce(current_setting('app.system_op', true), '') = 'on' then
    return new;
  end if;

  -- The assignee's bookable calendar. No active resource means there is nothing to materialise, so
  -- nothing to be authorised for — assigning work to someone without a calendar stays possible
  -- (ADR-0040 d.3).
  select r.id into v_resource
  from public.resources r
  where r.user_id = new.assignee_id and r.kind = 'human' and r.is_active
  limit 1;

  if v_resource is null then
    return new;
  end if;

  if not app.has_permission('bookings', 'create') then
    raise exception
      'you cannot assign this task: scheduling it needs the bookings:create permission, which you do not hold'
      using errcode = '42501';
  end if;

  if not app.resource_in_write_scope(v_resource) then
    raise exception
      'you cannot assign this task: % is outside the part of the organisation you can schedule',
      (select display_name from public.user_profiles where id = new.assignee_id)
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function app.tg_subtask_assignment_authority() is
  'ADR-0040: giving somebody work and occupying their time are the same authority. Refuses an '
  'assignment the assigner could not schedule, BEFORE the task is written — the split between the '
  'create gate and the scheduling gate is what let assignments half-succeed and silently duplicate.';

create trigger subtask_assignment_authority
  before insert or update of assignee_id on sub_tasks
  for each row execute function app.tg_subtask_assignment_authority();

commit;
