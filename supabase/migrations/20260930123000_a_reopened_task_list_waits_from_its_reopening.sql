-- I68.5, found building it (30 Sep): a task list that was approved and is opened again waits from the moment it was
-- opened again — not from the campaign's approval.
--
-- The cause. Every reader of "how long has this list waited" — `my_pending_approvals` (the Needs-you card and its
-- "escalates in…"), `escalation_due`'s task_list rung, and the view `task_list_waiting` — passes the CAMPAIGN's
-- approval to `app.task_list_waiting_since(kind, approved_at)` (ADR-0119 d.3). That was right while a list was only ever
-- unapproved once, before its first approval. Since ADR-0132 d.4 a list is cleared again when someone other than the
-- owner adds a task or changes the type (and since I59 E7 when an accepted change request changes the type): on a
-- campaign approved days ago its waiting time was already days, so the next sweep escalated it at once. And the rung's
-- escalation log keyed the list on occurrence `''`, so a list escalated once was never escalated again after a
-- reopening.
--
-- The fix.
--   1) `deliverables.task_list_reopened_at` — stamped by a trigger whenever an approved list's approval is cleared, by
--      whatever path (`sub_tasks_added_to_an_approved_list`, `change_deliverable_type`, `edit_piece_directly`,
--      `apply_deliverable_change_request`). Written only by that trigger: a client value is ignored.
--   2) `app.task_list_waiting_since(kind, approved_at, reopened_at)` — the later of the old answer and the reopening.
--   3) The three readers call it with the deliverable's stamp; the rung keys its log on the stamp, so each reopening
--      escalates once. The three are reproduced WHOLE from the database's own definitions (pg_get_functiondef /
--      pg_get_viewdef of the local stack at 20260930122000); the only edits are those named here.

begin;

alter table deliverables add column if not exists task_list_reopened_at timestamptz;
comment on column deliverables.task_list_reopened_at is
  'I68.5: when an approved task list was last opened again (its approval cleared). The waiting clock of the Needs-you '
  'card and the task_list escalation runs from here when it is later than the campaign''s approval. Trigger-written.';

create or replace function app.tg_deliverable_stamp_task_list_reopened() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if tg_op = 'INSERT' then
    new.task_list_reopened_at := null;
  elsif old.tasks_approved_at is not null and new.tasks_approved_at is null then
    new.task_list_reopened_at := now();
  else
    new.task_list_reopened_at := old.task_list_reopened_at;
  end if;
  return new;
end $$;

comment on function app.tg_deliverable_stamp_task_list_reopened() is
  'I68.5: stamps deliverables.task_list_reopened_at when an approved task list''s approval is cleared; keeps it '
  'otherwise, so no client write can move the clock.';

create trigger deliverable_stamp_task_list_reopened
  before insert or update on deliverables
  for each row execute function app.tg_deliverable_stamp_task_list_reopened();

create or replace function app.task_list_waiting_since(p_kind text, p_approved_at timestamptz, p_reopened_at timestamptz)
returns timestamptz
language sql stable security definer
set search_path = public, app, extensions
as $$
  select case
    when app.task_list_waiting_since(p_kind, p_approved_at) is null then null
    else greatest(app.task_list_waiting_since(p_kind, p_approved_at), p_reopened_at)
  end;
$$;

comment on function app.task_list_waiting_since(text, timestamptz, timestamptz) is
  'I68.5: ADR-0119 d.3''s clock, or the moment the list was opened again when that is later.';

-- ---- my_pending_approvals (from 20260929160000, via pg_get_functiondef) ----
CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS TABLE(kind text, id uuid, title text, campaign_id uuid, campaign_name text, department text, since timestamp with time zone, target_id uuid, deliverable_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ADR-0100 d.4: "write your department's brief" and "approve your department's brief" are GONE.
  -- The document they asked for no longer exists, so neither does the ask. (Removing them also
  -- takes out the branch I54.25 found scanning every task in the tenant — a side effect, not a
  -- reason.)
  -- A task list waiting for approval (ADR-0090; every campaign since ADR-0100 d.2) — on the owner's list,
  -- and (ADR-0119 d.2) on the department lead's and every team lead's of the deliverable's department,
  -- where they may approve it. Every campaign, however old (d.1). `since` is when its clock started —
  -- the one the escalation reads (d.3), so the card and the sweep agree.
  -- I66.3 (Edward, 29 Sep): a piece with no live task has no list to approve — "there is nothing to count" —
  -- but its owner still owes something: the tasks. Same people, same clock, its own kind, so the card says
  -- "define the tasks" and the "Task lists not approved" figures leave it out.
  select case when not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
              then 'task_list_undefined' else 'task_list' end,
         d.id, d.name, c.id, c.name, dp.name, app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
    left join user_profiles own on own.id = d.owner_user_id
   where c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and (d.owner_user_id = auth.uid()
          or app.leads_department(coalesce(d.department_id, own.department_id)))
     and app.may_approve_deliverable_tasks(d)
     -- I66.11: a piece whose every task was cancelled has its own card, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- I66.11 (Edward, 29 Sep, option B): every task on the piece was cancelled and none was done, so nothing will
  -- close it (ADR-0118 addendum: work all called off is never Approved). Its OWNER is asked to add a task or
  -- close the deliverable; `since` is the last cancellation.
  select 'tasks_all_cancelled', d.id, d.name, c.id, c.name, dp.name,
         (select max(t.updated_at) from sub_tasks t where t.deliverable_id = d.id), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and d.owner_user_id = auth.uid()
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')

  union all
  -- A booking on somebody I lead, asked for by somebody outside their reach (ADR-0087).
  select 'booking_request', q.id, q.title, c.id, c.name, dp.name, q.created_at, q.sub_task_id, d.id
    from sub_task_assignment_requests q
    join sub_tasks st   on st.id = q.sub_task_id
    join deliverables d on d.id = st.deliverable_id
    left join streams s      on s.id = d.stream_id
    left join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where q.status = 'pending'
     and q.requested_by <> auth.uid()
     and auth.uid() in (select a.user_id from public.assignment_request_approvers(q.resource_id) a)
     and app.has_permission('bookings', 'create')
     and app.resource_in_scheduling_scope(q.resource_id)

  union all
  -- A deadline extension asked of ME (ADR-0088).
  select 'extension_request', x.request_id, x.task_title, x.campaign_id, x.campaign_name, dp.name, x.created_at, x.sub_task_id, x.deliverable_id
    from public.sub_task_extension_requests x
    left join departments dp on dp.id = x.department_id
   where x.event_type = 'extension_requested'
     and x.is_pending
     and x.approver_id = auth.uid()
     and x.viewer_can_decide
     and x.actor_id <> auth.uid()

  union all
  -- A campaign or job waiting for ME, its account manager (ADR-0048 d.9).
  select 'campaign', c.id, c.name, c.id, null, null, c.created_at, c.id, null::uuid
    from campaigns c
   where c.status = 'pending_approval'
     and c.account_manager_id = auth.uid()
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, c.account_manager_id)

  order by 7 asc nulls last;
$function$;

-- ---- escalation_due (from 20260929160000, via pg_get_functiondef) ----
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
  select d.tenant_id, 'task_list', d.id, coalesce(d.task_list_reopened_at::text, ''), 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at),
         app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now), r.hours,
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
     and app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = coalesce(d.task_list_reopened_at::text, ''))
     -- I66.11: every task cancelled has its own rung, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- ---- task_list, every task cancelled (I66.11): the owner has not added a task or closed the piece. The same
  -- rung's hours and recipients, counted from the last cancellation; `occurrence` is that moment, so a piece
  -- cancelled again later escalates again. ----
  select d.tenant_id, 'task_list', d.id, 'all_cancelled:' || x.last_cancel::text, 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         x.last_cancel, app.elapsed_hours(x.last_cancel, p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind, 'all_cancelled', true,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
    cross join lateral (select max(t.updated_at) as last_cancel from sub_tasks t where t.deliverable_id = d.id) x
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')
     and app.elapsed_hours(x.last_cancel, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = 'all_cancelled:' || x.last_cancel::text)

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

-- ---- task_list_waiting (from 20260929130000, via pg_get_viewdef) ----
create or replace view public.task_list_waiting
  with (security_invoker = true) as
SELECT d.id AS deliverable_id,
    d.tenant_id,
    app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at) AS since
   FROM deliverables d
     JOIN streams s ON s.id = d.stream_id
     JOIN campaigns c ON c.id = s.campaign_id
  WHERE c.status = 'approved'::text AND d.tasks_approved_at IS NULL AND d.state <> 'archived'::deliverable_state;

commit;
