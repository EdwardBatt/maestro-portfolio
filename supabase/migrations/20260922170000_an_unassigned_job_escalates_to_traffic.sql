-- SJ-v3-04 (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep) — an unassigned job escalates on its own.
--
-- The Figma's line under the team picker: *"You never pick a person. If Fadia has not assigned it
-- within 24 hours it escalates to the traffic manager on its own."* ADR-0045 (accepted 27 Aug)
-- is the decision behind it: work that stalls is chased, then escalated; the thresholds belong to
-- the tenant (d.3), the sweep is one cron-driven function on the `archive-sweep` pattern (d.1),
-- and nobody is escalated behind their back (d.2). This is that ladder's first rung built:
-- an OPENED single job whose deliverable still has an unassigned task after
-- `assignment_escalation_hours` goes to the tenant's traffic managers (the `scheduler` role — ADR-0070
-- calls it Traffic) AND to the deliverable's owner, once. The rung for review reminders (I14.7)
-- shares the function and the setting row and follows.
--
--   * `tenant_reminder_settings.assignment_escalation_hours` — default 24, a typed column with a
--     CHECK (d.3), beside the three the row already holds.
--   * `deliverables.assignment_escalated_at` — the sweep's bookkeeping, so a re-run never sends
--     twice (idempotent by construction, d.1).
--   * `assignment_overdue` — a new notification type. Words in notify-email and in
--     `notifications.type.*` EN/AR (src/test/notification-copy.test.ts holds the three together).
--   * `app.escalate_unassigned_jobs()` — the due-set query and the inserts, one call, service role
--     only; `stall-sweep` (the Edge Function) is what cron invokes.
--
-- Hours are counted on the Iraq working week — Friday and Saturday do not count (ADR-0005's office
-- calendar, at day granularity; the office-hour refinement is I14.7's).

begin;

alter table tenant_reminder_settings
  add column if not exists assignment_escalation_hours integer not null default 24
  constraint chk_reminder_assignment_escalation_hours check (assignment_escalation_hours > 0);

comment on column tenant_reminder_settings.assignment_escalation_hours is
  'SJ-v3-04 / ADR-0045 d.3 (22 Sep): an opened single job whose task is still unassigned after this '
  'many working hours (Fri/Sat not counted) is escalated to the traffic managers and its owner.';

alter table deliverables
  add column if not exists assignment_escalated_at timestamptz;

comment on column deliverables.assignment_escalated_at is
  'When the unassigned-job escalation was sent (app.escalate_unassigned_jobs). Null = not yet. '
  'The sweep''s idempotence.';

-- ---------------------------------------------------------------- the type ----
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
    'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added',
    'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested',
    'assignment_overdue'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. blocked and brief_awaiting_approval removed 17 Sep: nothing raised the first, and '
  'the second could only fire for a brief that existed before approval, which none does. '
  'assignment_overdue added 22 Sep (SJ-v3-04, ADR-0045): an opened job still unassigned after the '
  'tenant''s hours, to the traffic managers and the owner.';

-- ---------------------------------------------------------------- working hours ----
-- Hours between two instants, Friday and Saturday (Iraq) not counted — whole days at 24h each,
-- the fraction of the first and last day kept. Enough for a 24-hour rung; the office-hours
-- refinement is I14.7's.
create or replace function app.working_hours_between(p_from timestamptz, p_to timestamptz)
returns numeric
language plpgsql immutable
set search_path = public, app as $$
declare
  v_from timestamp := p_from at time zone 'Asia/Baghdad';
  v_to   timestamp := p_to   at time zone 'Asia/Baghdad';
  v_day  date;
  v_hours numeric := 0;
  v_start timestamp;
  v_end   timestamp;
begin
  if v_to <= v_from then return 0; end if;
  v_day := v_from::date;
  while v_day <= v_to::date loop
    -- 5 = Friday, 6 = Saturday (ISO day of week)
    if extract(isodow from v_day) not in (5, 6) then
      v_start := greatest(v_from, v_day::timestamp);
      v_end   := least(v_to, (v_day + 1)::timestamp);
      if v_end > v_start then
        v_hours := v_hours + extract(epoch from (v_end - v_start)) / 3600.0;
      end if;
    end if;
    v_day := v_day + 1;
  end loop;
  return v_hours;
end $$;

comment on function app.working_hours_between(timestamptz, timestamptz) is
  'Hours between two instants on the Iraq week — Friday and Saturday not counted. ADR-0045''s '
  'thresholds are working hours; this is the day-granularity reading of that.';

-- ---------------------------------------------------------------- the rung ----
create or replace function app.escalate_unassigned_jobs(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  r record;
  v_sent integer := 0;
  v_hours numeric;
begin
  -- Opened single jobs whose one deliverable still has a task nobody is assigned to, not yet
  -- escalated. Cancelled and done tasks do not count; a job with no tasks at all (untyped —
  -- ADR-0051 d.7) has nothing to assign and is left alone.
  for r in
    select d.id as deliverable_id, d.name, d.tenant_id, d.owner_user_id, c.id as campaign_id, c.name as campaign_name,
           c.approved_at, coalesce(s.assignment_escalation_hours, 24) as threshold,
           (select count(*) from sub_tasks t
             where t.deliverable_id = d.id and t.assignee_id is null and t.status in ('todo', 'in_progress', 'blocked', 'review')) as unassigned
      from deliverables d
      join streams st on st.id = d.stream_id
      join campaigns c on c.id = st.campaign_id
      left join tenant_reminder_settings s on s.tenant_id = c.tenant_id
     where c.kind = 'single_job'
       and c.status = 'approved'
       and c.approved_at is not null
       and d.assignment_escalated_at is null
       and d.state not in ('archived', 'delivered')
  loop
    if r.unassigned = 0 then continue; end if;
    v_hours := app.working_hours_between(r.approved_at, p_now);
    if v_hours < r.threshold then continue; end if;

    -- The traffic managers: everyone holding the tenant's `scheduler` role. Then the owner, so
    -- nobody is escalated behind their back (ADR-0045 d.2).
    insert into notifications (tenant_id, user_id, type, label, context_label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, up.id, 'assignment_overdue', r.name, r.campaign_name, 'deliverable', r.deliverable_id, null,
           jsonb_build_object('owner', (select display_name from user_profiles where id = r.owner_user_id),
                              'hours', round(v_hours), 'threshold', r.threshold, 'unassigned', r.unassigned, 'for_owner', false)
      from user_profiles up
      join roles ro on ro.id = up.role_id
     where up.tenant_id = r.tenant_id and ro.key = 'scheduler' and up.is_active;

    if r.owner_user_id is not null then
      insert into notifications (tenant_id, user_id, type, label, context_label, entity_type, entity_id, actor_id, detail)
      values (r.tenant_id, r.owner_user_id, 'assignment_overdue', r.name, r.campaign_name, 'deliverable', r.deliverable_id, null,
              jsonb_build_object('owner', (select display_name from user_profiles where id = r.owner_user_id),
                                 'hours', round(v_hours), 'threshold', r.threshold, 'unassigned', r.unassigned, 'for_owner', true));
    end if;

    update deliverables set assignment_escalated_at = p_now where id = r.deliverable_id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;

revoke execute on function app.escalate_unassigned_jobs(timestamptz) from public, anon, authenticated;
grant  execute on function app.escalate_unassigned_jobs(timestamptz) to service_role;

comment on function app.escalate_unassigned_jobs(timestamptz) is
  'SJ-v3-04 / ADR-0045 (22 Sep): every opened single job whose deliverable still has an unassigned '
  'task after the tenant''s assignment_escalation_hours (working hours, Fri/Sat not counted) is '
  'escalated ONCE — a notification to each traffic manager (the scheduler role) and to the owner. '
  'Service role only: `stall-sweep` calls it on cron. Returns how many jobs were escalated.';

-- The public wrapper the Edge Function calls through PostgREST.
create or replace function public.escalate_unassigned_jobs() returns integer
language sql security definer set search_path = public, app as $$
  select app.escalate_unassigned_jobs(now());
$$;
revoke execute on function public.escalate_unassigned_jobs() from public, anon, authenticated;
grant  execute on function public.escalate_unassigned_jobs() to service_role;

commit;
