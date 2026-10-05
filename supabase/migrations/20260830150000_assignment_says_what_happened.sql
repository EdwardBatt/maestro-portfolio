-- I29 (ADR-0061) — assigning work says what actually happened.
--
-- Five duplicate ad-hoc tasks, one investigation, six defects of one family: the system was
-- confident and quiet about work it had not scheduled. This migration is the database half —
-- d.4 (moving work tells the person), d.5 (bookable means one thing) and d.6 (an ad-hoc deliverable
-- follows its task). The client half and the working-week rule (d.2) are code.
--
-- Functions are reproduced WHOLE, the house pattern: a bare `create or replace` resets `proconfig`
-- and drops the ADR-0033 `search_path` pin.

begin;

-- ============================================================================
-- 1) moving somebody's work tells them (ADR-0061 d.4)
-- ============================================================================
-- Drag a task's booking from Wednesday to Friday and everything updates — the booking moves, the
-- task's dates recompute, `schedule_overridden` flips — and the person doing the work is not told.
-- Twice over: `booking_notify_resource` fires only `on update of resource_id`, and its first line
-- exits for any booking carrying a sub_task_id, because "sub-task bookings ride the sub-task
-- notification" — which fires on `assignee_id`, which did not change.
--
-- **There was no notification type for it either**, so this is not a missed trigger; the concept
-- did not exist. Move somebody's work to another DAY and they heard nothing; move it to another
-- PERSON and they were told.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved','deliverable_reassigned','rescheduled'));

-- SECURITY DEFINER (search_path pinned): the person moving a booking may not be able to write a
-- notification row for somebody else. Scoped to the one assignee of the one linked task.
create or replace function app.tg_booking_notify_reschedule() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare v sub_tasks;
begin
  if new.sub_task_id is null then return new; end if;

  -- The DAY is what a person needs to hear about. A load or state change on the same day is not a
  -- move, and telling somebody their Tuesday is still their Tuesday is noise that trains people to
  -- ignore the channel.
  if new.starts_at is not distinct from old.starts_at
     and new.ends_at is not distinct from old.ends_at then
    return new;
  end if;

  -- The materialiser never UPDATEs — it deletes and re-inserts (20260817120000) — so reaching here
  -- means a human moved it. The same property `schedule_overridden` relies on.
  select * into v from sub_tasks where id = new.sub_task_id;
  if v.assignee_id is null or v.assignee_id is not distinct from auth.uid() then
    return new;                               -- unassigned, or you moved your own work
  end if;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (v.tenant_id, v.assignee_id, 'rescheduled', v.title, 'sub_task', v.id, auth.uid());
  return new;
end $$;

comment on function app.tg_booking_notify_reschedule() is
  'ADR-0061 d.4: tell a task''s assignee when their work moves to different days. Only on a change '
  'of DAY, never on load or state; never to the person who moved it; never from the materialiser, '
  'which deletes and re-inserts rather than updating.';

create trigger booking_notify_reschedule after update on bookings
  for each row execute function app.tg_booking_notify_reschedule();

-- ============================================================================
-- 2) an ad-hoc deliverable follows its task when it is cancelled (d.6)
-- ============================================================================
-- Cancelling the task left the deliverable at `in_progress`, so an abandoned attempt sat in the
-- Live list looking exactly like real work. That is most of why five rows read as clutter rather
-- than as a bug — the person could not tell which one was live.
--
-- Ad-hoc deliverable state ALREADY follows its task in the other direction: approving the task
-- signs the deliverable off (20260825120000). This applies the same rule to the other end.
--
-- CAMPAIGN deliverables are deliberately untouched: they hold many tasks, and one being cancelled
-- says nothing about the rest. The fence is `stream_id is null`, the same one ADR-0035 uses.
--
-- Reproduced WHOLE from 20260824180000:40.
create or replace function public.sub_task_cancel(p_sub_task uuid)
returns void language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks; v_stream uuid; v_live integer;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002';
  end if;

  if v.status = 'cancelled' then
    return;                                   -- idempotent: cancelling twice is not an error
  end if;
  if v.status = 'done' then
    raise exception 'an approved task cannot be cancelled — it is already complete'
      using errcode = '22023';
  end if;

  -- Same authority as assigning it: whoever may give this work out may call it off.
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'cancelling this task is outside your scope' using errcode = '42501';
  end if;

  update sub_tasks set status = 'cancelled' where id = p_sub_task;

  -- Free the calendar. Cancelled work must stop consuming capacity, or the schedule keeps telling
  -- everyone that person is busy.
  delete from bookings where sub_task_id = p_sub_task;

  if v.assignee_id is not null and v.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v.tenant_id, v.assignee_id, 'cancelled', v.title, 'sub_task', v.id, auth.uid());
  end if;

  -- ADR-0061 d.6. An AD-HOC deliverable IS its task, so cancelling the last live one settles it.
  -- `archived` rather than `cancelled`: the deliverable states are draft/in_progress/in_review/
  -- approved/delivered/archived, and archived is the one that means "off the live list, kept for
  -- the record" — which is exactly what a called-off ad-hoc job is.
  --
  -- app.is_system_op() so the transition guard treats this as the consequence of an authorised act
  -- rather than a hand-made state change, the same way the materialiser is treated.
  if v.deliverable_id is not null then
    select d.stream_id into v_stream from deliverables d where d.id = v.deliverable_id;
    if v_stream is null then
      select count(*) into v_live from sub_tasks st
       where st.deliverable_id = v.deliverable_id
         and st.status not in ('cancelled', 'done');
      if v_live = 0 then
        perform set_config('app.system_op', 'on', true);
        update deliverables set state = 'archived'
         where id = v.deliverable_id and state <> 'archived';
        perform set_config('app.system_op', 'off', true);
      end if;
    end if;
  end if;
end $$;

comment on function public.sub_task_cancel(uuid) is
  'Cancel a task: status → cancelled, its bookings released, and the assignee told. Soft by design — '
  'the row survives for the record. ADR-0061 d.6: cancelling the LAST live task of an AD-HOC '
  'deliverable archives it, so an abandoned attempt stops sitting in the live list looking like real '
  'work. A campaign deliverable holds many tasks and is never settled by one of them.';

-- ============================================================================
-- 3) work is only given to somebody who can actually do it (d.5)
-- ============================================================================
-- Edward, 30 Aug: *"IF I SAY THEY DO NOT APPEAR AS A CHOICE ON /SCHEDULE THIS MEANS THEY CANNOT BE
-- SELECTED OR ASSIGNED TO A TASK … AS A RESOURCE OR AS A USER."*
--
-- `resources.is_active` is the flag `/schedule` already honours. This makes it mean the same thing
-- on the assignment side, so the two surfaces can no longer disagree about who can be given work.
--
-- **A GUARD, NOT A FILTER.** The pickers narrow (client), and this refuses what a stale page could
-- still send. Both halves are needed: a filter alone is a suggestion.
--
-- **NEW ASSIGNMENTS ONLY.** Somebody already holding work keeps it — their task can still be
-- retitled, re-dated, reviewed and completed, and their bookings stay. Turning a person off stops
-- them being CHOSEN; it does not tear up what they are already doing. That is the difference
-- between this and a rule that would strand live work the moment an admin flipped a switch.
create or replace function app.person_is_bookable(p_user uuid) returns boolean
language sql stable set search_path = public, app, extensions as $$
  -- A human resource, active, and LINKED to this login. The link matters: an unlinked resource
  -- (user_id null) belongs to nobody — no assignee, no notification, no My Work — so it can never
  -- make a person assignable (ADR-0061 d.8).
  select exists (
    select 1 from resources r
     where r.user_id = p_user and r.kind = 'human' and r.is_active
  );
$$;

comment on function app.person_is_bookable(uuid) is
  'ADR-0061 d.5: can this person be given work? True when they have an ACTIVE HUMAN resource linked '
  'to their login — the same flag /schedule filters on, so the calendar and the assignment surfaces '
  'can no longer disagree about who exists.';

create or replace function public.save_sub_task(
  p_sub_task    uuid,
  p_deliverable uuid,
  p_title       text,
  p_reviewers   jsonb,
  p_description text default null,
  p_assignee    uuid default null,
  p_department  uuid default null,
  p_team        uuid default null,
  p_sla_hours   numeric default null,
  p_sla_profile uuid default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_status      text default null,
  p_review_mode text default null
) returns uuid
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id uuid := p_sub_task;
  v_was uuid;
begin
  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;
  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  -- ADR-0061 d.5, on a CHANGE of assignee only. Editing a task that is already held by somebody
  -- since made unbookable must keep working — the work exists and somebody is doing it.
  if v_id is not null then
    select assignee_id into v_was from sub_tasks where id = v_id and tenant_id = v_tenant;
  end if;
  if p_assignee is not null and p_assignee is distinct from v_was
     and not app.person_is_bookable(p_assignee) then
    raise exception 'that person is not bookable, so work cannot be assigned to them'
      using errcode = '22023';
  end if;

  if v_id is null then
    insert into sub_tasks (tenant_id, deliverable_id, title, description, assignee_id,
                           department_id, team_id, sla_hours, sla_profile_id,
                           starts_at, due_at, status, review_mode, created_by)
    values (v_tenant, p_deliverable, trim(p_title), p_description, p_assignee,
            p_department, p_team, p_sla_hours, p_sla_profile,
            p_starts_at, p_due_at, coalesce(p_status, 'todo'),
            coalesce(p_review_mode, 'digital'), auth.uid())
    returning id into v_id;
  else
    -- COALESCE, every field. NULL means "leave it alone".
    update sub_tasks set
      title          = trim(p_title),
      description    = coalesce(p_description, description),
      assignee_id    = coalesce(p_assignee, assignee_id),
      department_id  = coalesce(p_department, department_id),
      team_id        = coalesce(p_team, team_id),
      sla_hours      = coalesce(p_sla_hours, sla_hours),
      sla_profile_id = coalesce(p_sla_profile, sla_profile_id),
      starts_at      = coalesce(p_starts_at, starts_at),
      due_at         = coalesce(p_due_at, due_at),
      status         = coalesce(p_status, status),
      review_mode    = coalesce(p_review_mode, review_mode)
    where id = v_id and tenant_id = v_tenant;
    if not found then
      raise exception 'sub_task % not found', v_id using errcode = 'P0002';
    end if;
  end if;

  if p_reviewers is not null then
    if jsonb_array_length(p_reviewers) = 0 and p_assignee is not null then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;

    delete from sub_task_reviewers r
     where r.sub_task_id = v_id
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = v_id
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, v_id, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = v_id and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  return v_id;
end $$;

comment on function public.save_sub_task(uuid, uuid, text, jsonb, text, uuid, uuid, uuid, numeric, uuid, timestamptz, timestamptz, text, text) is
  'ADR-0043, extended by ADR-0059 d.4 and ADR-0061 d.5: write a task, its reviewers and its review '
  'mode in ONE transaction, and refuse to hand work to somebody who is not bookable. SECURITY '
  'INVOKER — RLS decides every write. The bookable check is on a CHANGE of assignee, so a task '
  'already held by somebody since switched off can still be edited and finished.';

-- ---------------------------------------------------------------------------
-- Reproduced WHOLE from 20260830120000.
create or replace function public.update_task_assignment(
  p_sub_task    uuid,
  p_title       text,
  p_assignee    uuid,
  p_reviewers   jsonb default null,
  p_starts_at   timestamptz default null,
  p_due_at      timestamptz default null,
  p_hours       numeric default null,
  p_review_mode text default null
) returns table(sub_task_id uuid, deliverable_id uuid, reschedule_needed boolean)
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v sub_tasks%rowtype;
  v_reassigned boolean;
  v_dates_changed boolean;
  v_lead uuid;
  v_dept uuid;
  v_team uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  -- Against `v`, the task as it stands NOW: testing the incoming department would make this a way
  -- out of a scope you do not hold (ADR-0060 d.9).
  if not (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id, app.deliverable_account_manager(v.deliverable_id))) then
    raise exception 'editing this task requires project-task management permission' using errcode = '42501';
  end if;

  if coalesce(trim(p_title), '') = '' then
    raise exception 'a task title is required' using errcode = '22023';
  end if;
  if p_assignee is null then
    raise exception 'an assignee is required' using errcode = '22023';
  end if;
  select up.department_id, up.team_id into v_dept, v_team
    from user_profiles up where up.id = p_assignee and up.tenant_id = v_tenant;
  if not found then
    raise exception 'that assignee is not in your organization' using errcode = '22023';
  end if;
  -- ADR-0061 d.5, on a CHANGE of assignee only.
  if p_assignee is distinct from v.assignee_id and not app.person_is_bookable(p_assignee) then
    raise exception 'that person is not bookable, so work cannot be assigned to them'
      using errcode = '22023';
  end if;
  if p_review_mode is not null and p_review_mode not in ('digital', 'manual') then
    raise exception 'review mode must be digital or manual' using errcode = '22023';
  end if;

  if p_reviewers is not null then
    if jsonb_typeof(p_reviewers) <> 'array' then
      raise exception 'the reviewer list must be a JSON array' using errcode = '22023';
    end if;
    if jsonb_array_length(p_reviewers) = 0 then
      raise exception 'a reviewer must be appointed for this task' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(p_reviewers) e) <>
       (select count(distinct e ->> 'user_id') from jsonb_array_elements(p_reviewers) e) then
      raise exception 'the same reviewer is listed twice' using errcode = '22023';
    end if;
  end if;

  v_reassigned := p_assignee is distinct from v.assignee_id;
  v_dates_changed := (p_starts_at is not null and p_starts_at is distinct from v.starts_at)
                  or (p_due_at    is not null and p_due_at    is distinct from v.due_at)
                  or (p_hours     is not null and p_hours     is distinct from v.sla_hours);

  update sub_tasks set
    title       = trim(p_title),
    assignee_id = p_assignee,
    -- ADR-0060 d.9. COALESCE: a person with no department recorded must not WIPE one the task had.
    department_id = coalesce(v_dept, department_id),
    team_id       = coalesce(v_team, team_id),
    starts_at   = coalesce(p_starts_at, starts_at),
    due_at      = coalesce(p_due_at, due_at),
    sla_hours   = coalesce(p_hours, sla_hours),
    review_mode = coalesce(p_review_mode, review_mode),
    schedule_overridden = case when v_reassigned or v_dates_changed then false else schedule_overridden end
  where id = p_sub_task;

  -- Appointments AFTER the assignee moves: one call can reassign the task AND name the previous
  -- assignee as a reviewer, and the write guard tests each appointment against the CURRENT assignee.
  if p_reviewers is not null then
    delete from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
       and not exists (
         select 1 from jsonb_array_elements(p_reviewers) e
         where (e ->> 'user_id')::uuid = r.user_id);

    update sub_task_reviewers r
       set is_mandatory = coalesce((e ->> 'is_mandatory')::boolean, false)
      from jsonb_array_elements(p_reviewers) e
     where r.sub_task_id = p_sub_task
       and r.user_id = (e ->> 'user_id')::uuid
       and r.is_mandatory is distinct from coalesce((e ->> 'is_mandatory')::boolean, false);

    insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
    select v_tenant, p_sub_task, (e ->> 'user_id')::uuid,
           coalesce((e ->> 'is_mandatory')::boolean, false), auth.uid()
    from jsonb_array_elements(p_reviewers) e
    where not exists (
      select 1 from sub_task_reviewers r
      where r.sub_task_id = p_sub_task and r.user_id = (e ->> 'user_id')::uuid);
  end if;

  if v.deliverable_id is not null then
    select r.user_id into v_lead from sub_task_reviewers r
     where r.sub_task_id = p_sub_task
     order by r.is_mandatory desc, r.created_at, r.user_id
     limit 1;
    update deliverables set
      reviewer_id = coalesce(v_lead, reviewer_id),
      name = case when stream_id is null then trim(p_title) else name end
    where id = v.deliverable_id;
  end if;

  update bookings set title = trim(p_title) where bookings.sub_task_id = p_sub_task;

  sub_task_id := p_sub_task;
  deliverable_id := v.deliverable_id;
  reschedule_needed := v_reassigned or v_dates_changed;
  return next;
end $$;

comment on function public.update_task_assignment(uuid, text, uuid, jsonb, timestamptz, timestamptz, numeric, text) is
  'ADR-0038/0040, amended by ADR-0043, ADR-0059 d.4, ADR-0060 d.9 and ADR-0061 d.5: assign a task, '
  'stamp its department and team from the person, and refuse to hand work to somebody who is not '
  'bookable. The write-scope gate reads the task BEFORE the change; the bookable check applies to a '
  'CHANGE of assignee, so work already held by somebody since switched off can still be finished.';

-- ============================================================================
-- 4) a deactivated person cannot be APPOINTED a reviewer either (ADR-0061 d.10)
-- ============================================================================
-- The reviewer picker already hid them — `public.users_holding_permission` filters `up.is_active`.
-- Nothing REFUSED them: this guard asks `app.user_holds_permission`, which reads role grants and
-- per-user overrides and has never looked at whether the account is live. Hidden, not enforced —
-- the same shape as the assignee gap above, and a stale page could still write one in.
--
-- **On INSERT only, and that is deliberate**, for the reason the existing eligibility check already
-- states: re-running it on UPDATE made a reviewer who later lost their standing able to strand their
-- own task, because clearing approvals is an UPDATE of these rows. Somebody deactivated AFTER they
-- were appointed keeps the appointment — see d.11, which surfaces it rather than deleting it.
--
-- Reproduced WHOLE from 20260827100000:152.
create or replace function app.tg_sub_task_reviewer_write_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_assignee uuid;
begin
  -- AN APPOINTMENT IS A PERSON ON A TASK. Neither half may be edited: a row whose user_id or
  -- sub_task_id can move is a way around the approved_at guard rather than through it.
  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'an appointment cannot change hands — remove it and appoint the other person'
        using errcode = '22023';
    end if;
    if new.sub_task_id is distinct from old.sub_task_id then
      raise exception 'an appointment cannot be moved to another task' using errcode = '22023';
    end if;
  end if;

  -- approved_at is not client-writable. Reset rather than raise: a caller who did not ask for it
  -- should not be punished, and a caller who did should not be obeyed.
  if coalesce(current_setting('app.reviewer_verdict', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.approved_at := null;
    else
      new.approved_at := old.approved_at;
    end if;
  end if;

  if tg_op = 'INSERT' then
    -- ADR-0061 d.10. Checked BEFORE the permission, because "that person has left" is the more
    -- useful sentence than "that person cannot moderate reviews" when both are true.
    if not exists (select 1 from public.user_profiles up
                    where up.id = new.user_id and up.is_active) then
      raise exception 'that person is deactivated and cannot be appointed a reviewer'
        using errcode = '22023';
    end if;

    -- Overlay-aware (app.user_holds_permission = role ∪ allow − deny, ADR-0036 L6.7).
    if not app.user_holds_permission(new.user_id, 'reviews', 'moderate') then
      raise exception 'the chosen reviewer cannot moderate reviews' using errcode = '22023';
    end if;

    select st.assignee_id into v_assignee from public.sub_tasks st where st.id = new.sub_task_id;
    if v_assignee is not null and v_assignee = new.user_id then
      raise exception 'the reviewer cannot be the assignee (no self-review)' using errcode = '22023';
    end if;
  end if;

  return new;
end $$;

comment on function app.tg_sub_task_reviewer_write_guard() is
  'ADR-0043 d.1/d.3, extended by ADR-0061 d.10: an appointment is a person on a task and neither '
  'half is editable; a named reviewer must be an ACTIVE user holding reviews:moderate and may never '
  'be the task''s assignee — all checked when they are appointed, not on every later write; '
  'approved_at is server-written only.';

commit;
