-- Schedule edit modal (I11.7): make the booking modal informative + editable.
--
-- Two permanent pieces + one temporary gate:
--   * sub_tasks.updated_by (+ stamp trigger) — "who last modified this task", for the modal. The
--     universal audit_events log is admin-only (audit_events_admin_select), so a schedule user can't
--     read it; a dedicated column is the queryable source. PERMANENT.
--   * public.update_task_assignment(...) — edit a task's core fields (title, assignee, reviewer,
--     dates/hours) from the modal, re-materialising the booking on reassignment. SECURITY DEFINER,
--     same pattern as public.create_adhoc_deliverable. The no-self-review guard is PERMANENT.
--   * TEMPORARY alpha (TMP.1 extension): the RPC is gated grant-only project_tasks:manage
--     (in_write_scope dropped) to match the wide-open alpha schedule. REVERT (with TMP.1): restore
--     `and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))`
--     to the gate. The updated_by column/trigger and the self-review guard stay.

begin;

-- 1) who last modified a sub-task (PERMANENT).
alter table sub_tasks add column updated_by uuid references user_profiles(id);
comment on column sub_tasks.updated_by is
  'Last user to modify this sub-task, stamped by trigger (audit_events is admin-only); shown in the schedule edit modal.';

create or replace function app.tg_stamp_subtask_updated_by() returns trigger
language plpgsql as $$
begin
  -- stamp only when an authenticated actor is present; system/definer paths with no JWT leave it as-is
  -- (so the materialiser and superuser backfills don't null a real value).
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;
comment on function app.tg_stamp_subtask_updated_by() is
  'Stamps sub_tasks.updated_by = auth.uid() on every authenticated update.';

-- fires after set_updated_at (both BEFORE UPDATE; trigger order is by name: set_ < stamp_).
create trigger stamp_updated_by before update on sub_tasks
  for each row execute function app.tg_stamp_subtask_updated_by();

-- 2) edit a task's core fields from the schedule modal. SECURITY DEFINER (search_path pinned, ADR-0033)
--    so it writes the sub_task + parent deliverable + linked bookings across scoped RLS, exactly like
--    public.create_adhoc_deliverable. Authoritative: enforces permission, tenant, and no-self-review.
create or replace function public.update_task_assignment(
  p_sub_task   uuid,
  p_title      text,
  p_assignee   uuid,
  p_reviewer   uuid default null,
  p_starts_at  timestamptz default null,
  p_due_at     timestamptz default null,
  p_hours      numeric default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
begin
  -- TEMPORARY alpha (TMP.1 ext): grant-only gate; in_write_scope dropped (revert restores it).
  if not app.has_permission('project_tasks', 'manage') then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  if not exists (select 1 from user_profiles where id = p_assignee and tenant_id = v_tenant) then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  if p_reviewer is not null and not exists (
    select 1 from user_profiles where id = p_reviewer and tenant_id = v_tenant
  ) then
    raise exception 'that reviewer is not in your organization' using errcode = '22023';
  end if;
  -- No self-review (PERMANENT): the reviewer may not be the assignee.
  if p_reviewer is not null and p_reviewer = p_assignee then
    raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    -- reset the human-override flag so subtask-schedule rebuilds the booking on reassign / date change
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- parent deliverable: set the designated reviewer always; only rename an AD-HOC deliverable
  -- (stream_id null) — never rename a project (stream-backed) deliverable from a booking edit.
  if v.deliverable_id is not null then
    update deliverables set
      reviewer_id = p_reviewer,
      name = case when stream_id is null then trim(p_title) else name end
    where id = v.deliverable_id;
  end if;

  -- keep the linked booking's title column in step (chip label for ad-hoc comes via deliverable name).
  -- Qualify bookings.sub_task_id — the OUT parameter sub_task_id would otherwise shadow it.
  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) is
  'I11.7: edit a task (title, assignee, reviewer, dates/hours) from the schedule modal. TEMP alpha '
  '(TMP.1 ext): gated project_tasks:manage only (in_write_scope dropped). No self-review (permanent). '
  'Resets schedule_overridden on reassign/date change so subtask-schedule re-materialises the booking.';

revoke execute on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) from public;
grant  execute on function public.update_task_assignment(uuid, text, uuid, uuid, timestamptz, timestamptz, numeric) to authenticated;

commit;
