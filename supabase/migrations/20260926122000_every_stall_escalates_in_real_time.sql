-- I59.24 / ADR-0108 (25 Sep, Edward) — the stall sweep grows from one rung to every rung whose source
-- exists, all on REAL elapsed time, plus the weekly over-capacity check.
--
-- WHAT CHANGES FOR THE ONE RUNG THAT EXISTED (`app.escalate_unassigned_jobs`, 20260922170000 — the
-- only definition, grep confirmed; reproduced WHOLE below as a caller of the general sweep):
--   * d.1: hours are REAL elapsed hours. `app.working_hours_between` (Fri/Sat not counted) is no
--     longer called anywhere in this path; the function stays (pgTAP 146 reads it; nothing else does).
--   * d.2/d.3: the hours and the recipients come from `tenant_escalation_rules` (kind 'unassigned'),
--     not from `assignment_escalation_hours` and a hard-coded `scheduler` role.
--   * d.4: campaign pieces escalate too — the clock starts at the piece's task-list approval
--     (`deliverables.tasks_approved_at`, stamped by `approve_deliverable_tasks`, ADR-0090 / ADR-0100).
--     A single job keeps its clock at the job's release (`campaigns.approved_at`).
--   * the notification is `escalated` with detail.kind = 'unassigned' (declared in 20260926090000),
--     replacing `assignment_overdue` for new escalations. Old rows are untouched.
--
-- THE RUNGS BUILT (their sources exist today):
--   unassigned       see above
--   task_list        a piece's task list not approved by its owner — clock from the campaign's
--                    approval (`campaigns.approved_at`; for a single job that is its release), the same
--                    set and the same cut-over as `my_pending_approvals` (20260923160000); AND a
--                    campaign whose brief waits for approval — clock from `campaigns.submitted_at`
--                    (20260926120000). Both are ADR-0108 d.2's row "Task list or brief not approved".
--   review_remind    a task in review whose reviewers have not all answered — clock from the round's
--                    submission (`task_time_entries.submitted_at` at the task's round,
--                    `sub_task_submit`) — `review_reminder` to the outstanding reviewers.
--   review_escalate  the same review, later — `escalated` to the account manager and the owner.
--   over_capacity    ADR-0108 d.6: a person booked over the tenant's `over_capacity_pct` this week —
--                    `over_capacity` (entity 'resource') to their team's scope-'team' leads and their
--                    department's scope-'department' leads, once per person per week.
--
-- HOOKS LEFT (their sources are being built by other I59 tracks today; their rule rows are seeded):
--   change_request (ADR-0110), extension_owner / extension_am (ADR-0109), blocked (ADR-0107).
--   Each joins `app.escalation_due` as one more `union all` (marked HOOK below) and
--   `app.escalation_cause_open` as one more branch.
--
-- IDEMPOTENT PER CAUSE (ADR-0045 d.1, ADR-0108 d.5): `escalation_log` (tenant, kind, subject,
-- occurrence) — inserted BEFORE the notifications, `on conflict do nothing`, so two overlapping runs
-- cannot both send. A cause with nobody to send to is not logged and is tried again next run.
--
-- The due set is ONE function (`app.escalation_due`) read by both the live sweep and the dry run, so
-- the dry run lists exactly what would be sent.

begin;

-- ---------------------------------------------------------------- one row shape ----
create type app.escalation_due_row as (
  tenant_id      uuid,
  kind           text,
  subject_id     uuid,
  occurrence     text,
  entity_type    text,
  entity_id      uuid,
  label          text,
  deliverable_id uuid,
  sub_task_id    uuid,
  campaign_id    uuid,
  since          timestamptz,
  hours          numeric,
  threshold      integer,
  extra          jsonb
);

-- Real elapsed hours (ADR-0108 d.1). Weekends and closed days count.
create or replace function app.elapsed_hours(p_from timestamptz, p_to timestamptz)
returns numeric language sql immutable as $$
  select greatest(0, extract(epoch from (p_to - p_from)) / 3600.0)::numeric;
$$;
comment on function app.elapsed_hours(timestamptz, timestamptz) is
  'ADR-0108 d.1: hours between two instants in REAL time — weekends and closed days included. Every '
  'escalation clock uses this; app.working_hours_between is no longer on any escalation path.';

-- ---------------------------------------------------------------- the week's load ----
-- The same arithmetic as `useTeamLoad` / `useMyLoad` (src/features/team/api/team-api.ts):
--   week       Sunday 00:00 to the next Sunday 00:00, local — `currentWeek` (:38-44). Local here is the
--              resource's office time zone, Asia/Baghdad when it has none (the browser's zone is what
--              the screen uses; every office today is in the region).
--   bookings   soft_hold / tentative / confirmed overlapping the week, the WHOLE booking counted —
--              `useBookingsList` (bookings-api.ts:105, :117-131): starts_at < end and ends_at > start.
--   hours      each booking rounded to 0.1h (`hoursBetween`, bookings-api.ts:78), summed, the sum
--              rounded to 0.1h (team-api.ts:132 / :215).
--   nominal    working days in the office's week x 8, 5 x 8 without an office (team-api.ts:46, :130-131).
--   util       round(booked / nominal x 100), 0 when nominal is 0 (team-api.ts:133).
--   people     active human resources (`useScheduleResources`, schedule-api.ts:99, kind 'human' :127);
--              department = the resource's own, else its team's (team-api.ts:137).
create or replace function app.week_load(p_now timestamptz default now())
returns table (
  tenant_id      uuid,
  resource_id    uuid,
  user_id        uuid,
  name           text,
  team_id        uuid,
  department_id  uuid,
  week_start     date,
  booked_hours   numeric,
  booking_count  integer,
  nominal_hours  numeric,
  util_pct       integer
)
language sql stable
set search_path = public, app, extensions as $$
  with res as (
    select r.id, r.tenant_id, r.user_id, r.name, r.team_id,
           coalesce(r.department_id, tm.department_id) as department_id,
           coalesce(o.timezone, 'Asia/Baghdad') as tz,
           coalesce(array_length(o.working_days, 1), 5) * 8 as nominal
      from resources r
      left join offices o on o.id = r.office_id
      left join teams tm  on tm.id = r.team_id
     where r.kind = 'human' and r.is_active
  ), wk as (
    select res.*,
           ((p_now at time zone res.tz)::date
             - extract(dow from (p_now at time zone res.tz))::int) as sun
      from res
  )
  select wk.tenant_id, wk.id, wk.user_id, wk.name, wk.team_id, wk.department_id, wk.sun,
         round(coalesce(sum(round((extract(epoch from (b.ends_at - b.starts_at)) / 3600.0)::numeric, 1)), 0), 1),
         count(b.id)::int,
         wk.nominal::numeric,
         case when wk.nominal > 0
              then round(round(coalesce(sum(round((extract(epoch from (b.ends_at - b.starts_at)) / 3600.0)::numeric, 1)), 0), 1)
                         / wk.nominal * 100)::int
              else 0 end
    from wk
    left join bookings b
      on b.resource_id = wk.id
     and b.state in ('soft_hold', 'tentative', 'confirmed')
     and b.starts_at < ((wk.sun + 7)::timestamp at time zone wk.tz)
     and b.ends_at   > (wk.sun::timestamp at time zone wk.tz)
   group by wk.tenant_id, wk.id, wk.user_id, wk.name, wk.team_id, wk.department_id, wk.sun, wk.nominal;
$$;

comment on function app.week_load(timestamptz) is
  'ADR-0108 d.6 (I59.24): each active person''s booked load for the Sunday–Saturday week containing '
  'p_now — the SAME arithmetic as useTeamLoad/useMyLoad (team-api.ts:106-233, bookings-api.ts:78/105/117), '
  'so the lead''s screen and the sweep agree. RLS applies to the caller.';

-- The leads who hear that someone is over: scope-'team' users in the person's team (the lead and the
-- deputy) and scope-'department' users in the person's department. Active only; never the person.
create or replace function app.over_capacity_recipients(p_resource uuid)
returns table (user_id uuid, reasons text[])
language sql stable security definer
set search_path = public, app, extensions as $$
  with p as (
    select r.tenant_id, r.user_id, r.team_id, coalesce(r.department_id, tm.department_id) as department_id
      from resources r left join teams tm on tm.id = r.team_id
     where r.id = p_resource
  ), found (user_id, reason) as (
    select up.id, 'team_lead'
      from p join user_profiles up on up.tenant_id = p.tenant_id and up.team_id = p.team_id
      join roles ro on ro.id = up.role_id
     where ro.scope = 'team' and p.team_id is not null
    union all
    select up.id, 'department_lead'
      from p join user_profiles up on up.tenant_id = p.tenant_id and up.department_id = p.department_id
      join roles ro on ro.id = up.role_id
     where ro.scope = 'department' and p.department_id is not null
  )
  select f.user_id, array_agg(distinct f.reason order by f.reason)
    from found f join user_profiles up on up.id = f.user_id
   where up.is_active and f.user_id is distinct from (select p.user_id from p)
   group by f.user_id;
$$;
revoke execute on function app.over_capacity_recipients(uuid) from public, anon, authenticated;
grant  execute on function app.over_capacity_recipients(uuid) to service_role;

-- ---------------------------------------------------------------- the due set ----
create or replace function app.escalation_due(p_now timestamptz default now())
returns setof app.escalation_due_row
language sql stable security definer
set search_path = public, app, extensions as $$
  -- ---- unassigned (ADR-0108 d.2 row 1, d.4) ----
  select d.tenant_id, 'unassigned', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         k.since, app.elapsed_hours(k.since, p_now), r.hours,
         jsonb_build_object('unassigned', u.n, 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'unassigned'
    cross join lateral (select case when c.kind = 'single_job' then c.approved_at
                                    else d.tasks_approved_at end as since) k
    cross join lateral (select count(*)::int as n from sub_tasks t
                         where t.deliverable_id = d.id and t.assignee_id is null
                           and t.status in ('todo', 'in_progress', 'blocked', 'review')) u
   where c.status = 'approved'
     and c.kind in ('single_job', 'campaign')
     and k.since is not null
     and d.state not in ('archived', 'delivered')
     and u.n > 0
     and app.elapsed_hours(k.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'unassigned'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- task_list: the piece's task list, waiting on its owner (ADR-0090 / ADR-0100) ----
  select d.tenant_id, 'task_list', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         c.approved_at, app.elapsed_hours(c.approved_at, p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
   where c.status = 'approved'
     and c.approved_at is not null
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     -- ADR-0100 d.7: a campaign approved before the cut-over never asked its owners.
     and (c.kind = 'single_job'
          or c.approved_at >= (select value::timestamptz from app_settings where key = 'task_list_gate_from'))
     and app.elapsed_hours(c.approved_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- task_list: the campaign's brief, waiting for approval (ADR-0048 d.9) ----
  select c.tenant_id, 'task_list', c.id, c.submitted_at::text, 'campaign', c.id, c.name, null::uuid, null::uuid, c.id,
         c.submitted_at, app.elapsed_hours(c.submitted_at, p_now), r.hours,
         jsonb_build_object('waiting_on', 'campaign_brief', 'campaign_kind', c.kind)
    from campaigns c
    join tenant_escalation_rules r on r.tenant_id = c.tenant_id and r.kind = 'task_list'
   where c.status = 'pending_approval'
     and c.submitted_at is not null
     and app.elapsed_hours(c.submitted_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = c.tenant_id and l.kind = 'task_list'
                        and l.subject_id = c.id and l.occurrence = c.submitted_at::text)

  union all
  -- ---- review_remind / review_escalate: a round sent and not answered (ADR-0043 / ADR-0089) ----
  select t.tenant_id, r.kind, t.id, t.revision_number::text, 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         s.since, app.elapsed_hours(s.since, p_now), r.hours,
         jsonb_build_object('round', t.revision_number + 1,
                            'outstanding', (select count(*) from sub_task_reviewers rv
                                             where rv.sub_task_id = t.id
                                               and rv.approved_at is null and rv.responded_at is null),
                            'deliverable', d.name)
    from sub_tasks t
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = t.tenant_id and r.kind in ('review_remind', 'review_escalate')
    cross join lateral (select max(e.submitted_at) as since from task_time_entries e
                         where e.sub_task_id = t.id and e.round = t.revision_number) s
   where t.status = 'review'
     and s.since is not null
     and exists (select 1 from sub_task_reviewers rv
                  where rv.sub_task_id = t.id and rv.approved_at is null and rv.responded_at is null)
     and app.elapsed_hours(s.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = t.tenant_id and l.kind = r.kind
                        and l.subject_id = t.id and l.occurrence = t.revision_number::text)

  union all
  -- ---- over_capacity (ADR-0108 d.6) ----
  select w.tenant_id, 'over_capacity', w.resource_id, w.week_start::text, 'resource', w.resource_id, w.name,
         null::uuid, null::uuid, null::uuid, (w.week_start::timestamp at time zone 'UTC'), null::numeric,
         coalesce(s.over_capacity_pct, 110),
         jsonb_build_object('booked_hours', w.booked_hours, 'nominal_hours', w.nominal_hours,
                            'util_pct', w.util_pct, 'over_capacity_pct', coalesce(s.over_capacity_pct, 110),
                            'week_start', w.week_start, 'booking_count', w.booking_count)
    from app.week_load(p_now) w
    left join tenant_reminder_settings s on s.tenant_id = w.tenant_id
   where w.util_pct > coalesce(s.over_capacity_pct, 110)
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = w.tenant_id and l.kind = 'over_capacity'
                        and l.subject_id = w.resource_id and l.occurrence = w.week_start::text)

  -- ---- HOOK (I59.21 blocked / ADR-0107, I59.22 extension_owner + extension_am / ADR-0109,
  --      I59.23 change_request / ADR-0110): one more `union all` each, reading its own source's
  --      "raised / sent / asked / forwarded" timestamp against tenant_escalation_rules.hours, keyed in
  --      escalation_log by (kind, the request's id, ''). Nothing is swept for these kinds yet. ----
  ;
$$;

revoke execute on function app.escalation_due(timestamptz) from public, anon, authenticated;
grant  execute on function app.escalation_due(timestamptz) to service_role;

comment on function app.escalation_due(timestamptz) is
  'ADR-0108 (I59.24): every stall that is due for escalation at p_now and not yet sent — the ONE due '
  'set the live sweep and the dry run both read. Rungs: unassigned, task_list (piece + campaign brief), '
  'review_remind, review_escalate, over_capacity. Real-time hours throughout (d.1).';

-- ---------------------------------------------------------------- the sweep ----
create or replace function app.run_escalation_sweep(
  p_now     timestamptz default now(),
  p_dry_run boolean default false,
  p_kind    text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  r        app.escalation_due_row;
  v_people jsonb;
  v_count  integer;
  v_log    uuid;
  v_type   text;
  v_sent   integer := 0;
  v_items  jsonb := '[]'::jsonb;
begin
  for r in select * from app.escalation_due(p_now) e where p_kind is null or e.kind = p_kind
           order by e.kind, e.since, e.subject_id loop
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
    else
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.escalation_recipients(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id) x;
    end if;
    v_count := jsonb_array_length(v_people);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id, 'label', r.label,
      'occurrence', r.occurrence, 'since', r.since, 'hours', round(r.hours, 1), 'threshold', r.threshold,
      'recipients', v_people, 'extra', r.extra));

    if p_dry_run or v_count = 0 then
      continue;
    end if;

    v_log := null;
    insert into escalation_log (tenant_id, kind, subject_id, occurrence, recipients, sent_at)
    values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_count, p_now)
    on conflict (tenant_id, kind, subject_id, occurrence) do nothing
    returning id into v_log;
    if v_log is null then
      continue;   -- another run sent this cause first
    end if;

    v_type := case r.kind when 'review_remind' then 'review_reminder'
                          when 'over_capacity' then 'over_capacity'
                          else 'escalated' end;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, (p ->> 'user_id')::uuid, v_type, r.label, r.entity_type, r.entity_id, null,
           coalesce(r.extra, '{}'::jsonb) || jsonb_build_object(
             'kind', r.kind, 'occurrence', r.occurrence, 'since', r.since,
             'hours', case when r.hours is null then null else round(r.hours) end,
             'threshold', r.threshold, 'as', p -> 'reasons')
      from jsonb_array_elements(v_people) p;

    -- The single-job rung's own stamp keeps its meaning ("when the unassigned escalation was sent").
    if r.kind = 'unassigned' then
      update deliverables set assignment_escalated_at = p_now
       where id = r.subject_id and assignment_escalated_at is null;
    end if;

    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'now', p_now, 'sent', v_sent,
                            'due', jsonb_array_length(v_items), 'items', v_items);
end $$;

revoke execute on function app.run_escalation_sweep(timestamptz, boolean, text) from public, anon, authenticated;
grant  execute on function app.run_escalation_sweep(timestamptz, boolean, text) to service_role;

comment on function app.run_escalation_sweep(timestamptz, boolean, text) is
  'ADR-0108 / ADR-0045 d.1 (I59.24): the stall sweep. For each due cause (app.escalation_due) resolves '
  'the recipients, logs the cause in escalation_log FIRST (once per cause, race-safe), then notifies: '
  '`escalated` (detail.kind), `review_reminder` for review_remind, `over_capacity` for overload. '
  'p_dry_run lists every due cause with its recipients and sends nothing. Returns {sent, due, items}.';

-- The rung that existed, now one kind of the general sweep. Signature and return kept.
create or replace function app.escalate_unassigned_jobs(p_now timestamptz default now())
returns integer
language sql
security definer
set search_path = public, app, extensions as $$
  select (app.run_escalation_sweep(p_now, false, 'unassigned') ->> 'sent')::int;
$$;

revoke execute on function app.escalate_unassigned_jobs(timestamptz) from public, anon, authenticated;
grant  execute on function app.escalate_unassigned_jobs(timestamptz) to service_role;

comment on function app.escalate_unassigned_jobs(timestamptz) is
  'SJ-v3-04 / ADR-0045, amended by ADR-0108 (26 Sep): the unassigned rung alone — single jobs from '
  'their release, campaign pieces from their task-list approval, REAL hours, recipients from '
  'tenant_escalation_rules, `escalated` (detail.kind unassigned). Returns how many were escalated.';

-- The Edge Function's door (service role only).
create or replace function public.run_escalation_sweep(p_dry_run boolean default false)
returns jsonb
language sql security definer set search_path = public, app as $$
  select app.run_escalation_sweep(now(), p_dry_run, null);
$$;
revoke execute on function public.run_escalation_sweep(boolean) from public, anon, authenticated;
grant  execute on function public.run_escalation_sweep(boolean) to service_role;

-- ---------------------------------------------------------------- still open? ----
create or replace function app.escalation_cause_open(
  p_kind text, p_entity_type text, p_entity_id uuid, p_occurrence text
) returns boolean
language sql stable
set search_path = public, app, extensions as $$
  select case
    when p_kind = 'unassigned' then exists (
      select 1 from deliverables d
       where d.id = p_entity_id and d.state not in ('archived', 'delivered')
         and exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.assignee_id is null
                       and t.status in ('todo', 'in_progress', 'blocked', 'review')))
    when p_kind = 'task_list' and p_entity_type = 'campaign' then exists (
      select 1 from campaigns c where c.id = p_entity_id and c.status = 'pending_approval')
    when p_kind = 'task_list' then exists (
      select 1 from deliverables d
       where d.id = p_entity_id and d.tasks_approved_at is null and d.state <> 'archived')
    when p_kind in ('review_remind', 'review_escalate') then exists (
      select 1 from sub_tasks t
       where t.id = p_entity_id and t.status = 'review' and t.revision_number::text = p_occurrence
         and exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = t.id
                       and rv.approved_at is null and rv.responded_at is null))
    -- HOOK (change_request, extension_owner, extension_am, blocked): until their sources exist an
    -- escalation of that kind is never hidden.
    else true
  end;
$$;

comment on function app.escalation_cause_open(text, text, uuid, text) is
  'ADR-0108 (I59.24): is the stall behind an escalation still there? Read by needs_me_escalations '
  'under the caller''s RLS. Unknown kinds (the four hooks) read as open.';

-- ---------------------------------------------------------------- Needs you ----
create or replace function public.needs_me_escalations()
returns table (
  notification_id uuid,
  kind            text,
  entity_type     text,
  entity_id       uuid,
  label           text,
  context_label   text,
  detail          jsonb,
  escalated_at    timestamptz
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select * from (
    select distinct on (n.detail ->> 'kind', n.entity_id, n.detail ->> 'occurrence')
           n.id, n.detail ->> 'kind', n.entity_type, n.entity_id, n.label, n.context_label, n.detail, n.created_at
      from notifications n
     where n.tenant_id = app.current_tenant_id()
       and n.user_id = auth.uid()
       and n.type = 'escalated'
       and app.escalation_cause_open(n.detail ->> 'kind', n.entity_type, n.entity_id, n.detail ->> 'occurrence')
     order by n.detail ->> 'kind', n.entity_id, n.detail ->> 'occurrence', n.created_at desc
  ) x
  order by x.created_at asc;
$$;
revoke execute on function public.needs_me_escalations() from public, anon;
grant  execute on function public.needs_me_escalations() to authenticated;

comment on function public.needs_me_escalations() is
  'ADR-0108 d.3 (I59.24): the escalations addressed to ME whose stall is still there — one row per '
  'cause, oldest first. My own notifications only (RLS); the cause read under my RLS.';

create or replace function public.needs_me_overload()
returns table (
  resource_id    uuid,
  user_id        uuid,
  name           text,
  team_id        uuid,
  department_id  uuid,
  week_start     date,
  booked_hours   numeric,
  nominal_hours  numeric,
  util_pct       integer,
  over_capacity_pct integer
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select w.resource_id, w.user_id, w.name, w.team_id, w.department_id, w.week_start,
         w.booked_hours, w.nominal_hours, w.util_pct, coalesce(s.over_capacity_pct, 110)
    from app.week_load(now()) w
    join user_profiles me on me.id = auth.uid()
    join roles ro on ro.id = me.role_id
    left join tenant_reminder_settings s on s.tenant_id = w.tenant_id
   where w.tenant_id = app.current_tenant_id()
     and w.util_pct > coalesce(s.over_capacity_pct, 110)
     and w.user_id is distinct from auth.uid()
     and ((ro.scope = 'team' and me.team_id is not null and me.team_id = w.team_id)
          or (ro.scope = 'department' and me.department_id is not null and me.department_id = w.department_id))
   order by w.util_pct desc, w.name;
$$;
revoke execute on function public.needs_me_overload() from public, anon;
grant  execute on function public.needs_me_overload() to authenticated;

comment on function public.needs_me_overload() is
  'ADR-0108 d.6 (I59.24): the people I lead (my team as a scope-team lead or deputy, my department as '
  'a scope-department lead) booked over the tenant''s over_capacity_pct THIS week — the item stays '
  'until the load drops. Same arithmetic as the sweep (app.week_load).';

commit;
