-- I59.31 / E11 (Edward, 25 Sep) — a task cannot be assigned without hours allocated. Mandatory on
-- every assignment route, refused by the database.
--
-- "Hours allocated" is `sub_tasks.sla_hours` — the total effort the scheduler spreads across the
-- span (`subtask-schedule`, `update_task_assignment.p_hours`). Its column check already refuses 0 and
-- negatives (20260812120000: `sla_hours is null or sla_hours > 0`), so the rule is: NOT NULL at the
-- moment a person is given the task.
--
-- WHERE IT IS HELD. A row trigger on `sub_tasks`, because every route writes the assignee there:
--   * update_task_assignment (the Schedule modal, the drag onto a person, a lead approving a booking
--     request through decide_assignment_request) — writes assignee_id AND sla_hours = coalesce(p_hours,
--     sla_hours) in ONE statement, so the trigger sees the hours given with the assignment;
--   * save_sub_task (the task editor) — p_assignee and p_sla_hours in the same insert / update;
--   * create_adhoc_deliverable — assignee and p_hours in the same insert;
--   * a bare PATCH / insert by anyone the policies let through.
-- No legitimate route writes the assignee first and the hours after (checked 26 Sep: grep over
-- supabase/migrations for `assignee_id =` and inserts naming assignee_id; subtask-schedule and the
-- frontend only read sla_hours before calling update_task_assignment).
--
-- A REQUEST is held too: `sub_task_assignment_requests` (ADR-0087) carries the assignment payload
-- until a lead answers. A request with no hours — neither sent nor already on the task — could only
-- be refused on approval, a dead end for the approver (ADR-0087 d.11), so it is refused when asked.
--
-- Fires for EVERY caller, system ops and migrations included: Edward's rule is "refused by the
-- database", and the tests that assign must give hours (E11). Unassigning, and edits that leave the
-- assignee alone, are untouched — an existing assigned task without hours stays as it is (no data is
-- changed here; E11 found none on production).

begin;

create or replace function app.tg_sub_task_assignment_needs_hours() returns trigger
language plpgsql
set search_path = public, app, extensions as $$
begin
  if new.assignee_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;
  if new.sla_hours is null then
    raise exception
      '"%" has no hours allocated, so it cannot be assigned — give it its hours first.', new.title
      using errcode = '22023', hint = 'hours_required';
  end if;
  return new;
end $$;

comment on function app.tg_sub_task_assignment_needs_hours() is
  'I59 E11 (25 Sep): a person is given a task only with its hours allocated (sla_hours not null; the '
  'column check already refuses 0 and negatives). On insert with an assignee and on any change of '
  'assignee, for every caller. 22023, hint hours_required.';

-- Named to sort AFTER sub_task_assignment_gate and subtask_assignment_authority (BEFORE triggers fire
-- alphabetically): "you may not assign this" is said before "it has no hours".
drop trigger if exists subtask_assignment_needs_hours on sub_tasks;
create trigger subtask_assignment_needs_hours
  before insert or update of assignee_id on sub_tasks
  for each row execute function app.tg_sub_task_assignment_needs_hours();

create or replace function app.tg_assignment_request_needs_hours() returns trigger
language plpgsql
set search_path = public, app, extensions as $$
declare v_title text; v_hours numeric;
begin
  select st.title, st.sla_hours into v_title, v_hours from sub_tasks st where st.id = new.sub_task_id;
  if coalesce(new.hours, v_hours) is null then
    raise exception
      '"%" has no hours allocated, so it cannot be assigned — give it its hours first.', coalesce(v_title, new.title)
      using errcode = '22023', hint = 'hours_required';
  end if;
  return new;
end $$;

comment on function app.tg_assignment_request_needs_hours() is
  'I59 E11: a booking request (ADR-0087) is raised only when the assignment it holds could be made — '
  'hours sent with it, or already on the task.';

drop trigger if exists assignment_request_needs_hours on sub_task_assignment_requests;
create trigger assignment_request_needs_hours
  before insert on sub_task_assignment_requests
  for each row execute function app.tg_assignment_request_needs_hours();

commit;
