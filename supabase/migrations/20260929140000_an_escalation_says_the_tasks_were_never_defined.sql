-- I66.4 (Edward, 29 Sep: "fix escalations") — a piece with no tasks escalates as "tasks not defined", not as a task
-- list that "has waited for approval".
--
-- I66.3 made a piece with no live task ask its owner to DEFINE the tasks (`task_list_undefined`). The sweep still
-- escalated it on the same rung and clock (ADR-0119 d.3 — unchanged), worded as a list waiting for approval. The
-- rung now records `no_tasks` in its detail; the sweep copies detail into the notice (20260926170000), and the
-- Needs you card and the mail say "its tasks have not been defined".
--
-- `app.escalation_due` reproduced WHOLE from 20260927200000 (grep confirmed the last definition); the only change
-- is `no_tasks` on the task_list rung.

begin;

CREATE OR REPLACE FUNCTION app.escalation_due(p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF app.escalation_due_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ---- unassigned (ADR-0108 d.2 row 1, d.4; I59 settled: every piece from its task list's approval) ----
  select d.tenant_id, 'unassigned', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         d.tasks_approved_at, app.elapsed_hours(d.tasks_approved_at, p_now), r.hours,
         jsonb_build_object('unassigned', u.n, 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'unassigned'
    cross join lateral (select count(*)::int as n from sub_tasks t
                         where t.deliverable_id = d.id and t.assignee_id is null
                           and t.status in ('todo', 'in_progress', 'blocked', 'review')) u
   where c.status = 'approved'
     and c.kind in ('single_job', 'campaign')
     and d.tasks_approved_at is not null
     and d.state not in ('archived', 'delivered')
     and u.n > 0
     and app.elapsed_hours(d.tasks_approved_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'unassigned'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- task_list: the piece's task list, waiting on its owner (ADR-0090 / ADR-0100) ----
  select d.tenant_id, 'task_list', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         app.task_list_waiting_since(c.kind, c.approved_at),
         app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at), p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id),
                            -- I66.4: a piece with no live task has no list to approve — its tasks were never
                            -- defined, and the escalation says that instead of "waited for approval".
                            'no_tasks', not exists (select 1 from sub_tasks t where t.deliverable_id = d.id
                                                                             and t.status not in ('done', 'cancelled')))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
   where c.status = 'approved'
     and c.approved_at is not null
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     -- ADR-0119 d.1/d.3: every campaign; one approved before the cut-over is timed from this release.
     and app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at), p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- campaign_brief (I59 E8): the campaign's brief, waiting on the account manager (ADR-0048 d.9) ----
  select c.tenant_id, 'campaign_brief', c.id, c.submitted_at::text, 'campaign', c.id, c.name, null::uuid, null::uuid, c.id,
         c.submitted_at, app.elapsed_hours(c.submitted_at, p_now), r.hours,
         jsonb_build_object('waiting_on', 'campaign_brief', 'campaign_kind', c.kind)
    from campaigns c
    join tenant_escalation_rules r on r.tenant_id = c.tenant_id and r.kind = 'campaign_brief'
   where c.status = 'pending_approval'
     and c.submitted_at is not null
     and app.elapsed_hours(c.submitted_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = c.tenant_id and l.kind = 'campaign_brief'
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

  union all
  -- ---- change_request (ADR-0110; hook): pending on its owner, from when it was sent ----
  select q.tenant_id, 'change_request', q.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, st.campaign_id,
         q.created_at, app.elapsed_hours(q.created_at, p_now), r.hours,
         jsonb_build_object('change_request_id', q.id, 'changes', q.changes, 'asked_by', q.asked_by,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverable_change_requests q
    join deliverables d on d.id = q.deliverable_id
    left join streams st on st.id = d.stream_id
    join tenant_escalation_rules r on r.tenant_id = q.tenant_id and r.kind = 'change_request'
   where q.status = 'pending'
     and d.state <> 'archived'
     and app.elapsed_hours(q.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = q.tenant_id and l.kind = 'change_request'
                        and l.subject_id = q.id and l.occurrence = '')

  union all
  -- ---- extension_owner / extension_am (ADR-0109; hooks): the step the request waits at ----
  select x.tenant_id, k.kind, x.request_id, '', 'sub_task', x.sub_task_id, x.task_title, x.deliverable_id,
         x.sub_task_id, x.campaign_id,
         k.since, app.elapsed_hours(k.since, p_now), r.hours,
         jsonb_build_object('request_id', x.request_id, 'stage', x.stage, 'from', x.from_at, 'to', x.to_at,
                            'deliverable', x.deliverable_name, 'owner', x.owner_name)
    from public.sub_task_extension_requests x
    cross join lateral (
      select case when x.stage = 'owner' then 'extension_owner' else 'extension_am' end as kind,
             case when x.stage = 'owner' then x.created_at else coalesce(x.forwarded_at, x.created_at) end as since
    ) k
    join tenant_escalation_rules r on r.tenant_id = x.tenant_id and r.kind = k.kind
   where x.stage in ('owner', 'am')
     and app.elapsed_hours(k.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = x.tenant_id and l.kind = k.kind
                        and l.subject_id = x.request_id and l.occurrence = '')

  union all
  -- ---- blocked (ADR-0107; hook): a maker's input on their own task, not cleared, from when raised ----
  select pin.tenant_id, 'blocked', pin.id, '', 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         pin.requested_at, app.elapsed_hours(pin.requested_at, p_now), r.hours,
         jsonb_build_object('input_id', pin.id, 'kind_of_input', pin.kind, 'awaited_from', pin.awaited_from,
                            'description', pin.description, 'deliverable', d.name)
    from deliverable_pending_inputs pin
    join sub_tasks t on t.id = pin.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = pin.tenant_id and r.kind = 'blocked'
   where pin.satisfied_at is null
     and t.status not in ('done', 'cancelled')
     and app.elapsed_hours(pin.requested_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = pin.tenant_id and l.kind = 'blocked'
                        and l.subject_id = pin.id and l.occurrence = '');
$function$;

commit;
