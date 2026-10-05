-- I70.6 (ADR-0133 d.5, accepted 30 Sep): an unfinished hand-over escalates like everything else (ADR-0108).
--
--   * `tenant_escalation_rules` gains the kind `handover` — hours and recipients are tenant settings like the other
--     nine; seeded 24 h to the Traffic Manager and the Power Admins (relative: none — the rule names no piece).
--   * `app.escalation_due` gains the `handover` arm: a Leaving person still holding work, `hours` from `leaving_since`,
--     `occurrence` = that moment. The detail names what is still waiting (`items` by kind, `total`).
--   * `app.run_escalation_sweep` reads the rule's roles for `handover` (not the piece-relative resolver, which needs a
--     piece), never the leaving person, falling back to the Traffic Manager as E9 does; and, before the escalations,
--     completes any hand-over whose list was emptied from the items' own pages (d.4).
--
-- Both functions re-emitted from their live definitions (pg_get_functiondef, local stack at 20260930130000); every
-- other arm and branch is unchanged.

alter table tenant_escalation_rules drop constraint if exists chk_tenant_escalation_rules_kind;
alter table tenant_escalation_rules add constraint chk_tenant_escalation_rules_kind check (kind = any (array[
  'unassigned', 'task_list', 'campaign_brief', 'change_request', 'extension_owner', 'extension_am', 'blocked',
  'review_remind', 'review_escalate',
  'handover'   -- ADR-0133 d.5
]::text[]));

create or replace function app.seed_tenant_escalation_rules(p_tenant uuid)
 returns void
 language plpgsql
 set search_path to 'public', 'app', 'extensions'
as $function$
declare
  v_traffic uuid := (select id from roles where tenant_id = p_tenant and key = 'scheduler');
  v_ad      uuid := (select id from roles where tenant_id = p_tenant and key = 'account_director');
  v_admin   uuid := (select id from roles where tenant_id = p_tenant and key = 'power_admin');
  v_hours   integer := coalesce(
    (select s.assignment_escalation_hours from tenant_reminder_settings s where s.tenant_id = p_tenant), 24);
begin
  insert into tenant_escalation_rules (tenant_id, kind, hours, role_ids, relative)
  values
    (p_tenant, 'unassigned',      v_hours, array_remove(array[v_traffic], null), array['owner']),
    (p_tenant, 'task_list',       24,      array_remove(array[v_traffic], null), array['account_manager']),
    -- I59 E8: the campaign / brief waiting on the account manager.
    (p_tenant, 'campaign_brief',  24,      array_remove(array[v_traffic, v_ad], null), '{}'),
    (p_tenant, 'change_request',  8,       '{}',                                  array['owner_department_lead', 'account_manager']),
    (p_tenant, 'extension_owner', 8,       '{}',                                  array['owner_department_lead']),
    (p_tenant, 'extension_am',    8,       array_remove(array[v_ad], null),      '{}'),
    (p_tenant, 'blocked',         24,      '{}',                                  array['owner', 'account_manager']),
    (p_tenant, 'review_remind',   24,      '{}',                                  array['reviewers']),
    (p_tenant, 'review_escalate', 48,      '{}',                                  array['account_manager', 'owner']),
    -- ADR-0133 d.5: a hand-over not finished — the Traffic Manager and the Power Admins.
    (p_tenant, 'handover',        24,      array_remove(array[v_traffic, v_admin], null), '{}')
  on conflict (tenant_id, kind) do nothing;
end $function$;

-- Every existing tenant gets the new row (the others already exist and are left as the tenant set them).
select app.seed_tenant_escalation_rules(id) from tenants;

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
                        and l.subject_id = pin.id and l.occurrence = '')

  union all
  -- ---- handover (ADR-0133 d.5, I70.6): a leaving person's work not all handed on, from when they started leaving.
  -- `occurrence` is that moment, so a person who leaves again later escalates again. ----
  select up.tenant_id, 'handover', up.id, up.leaving_since::text, 'user_profile', up.id, up.display_name,
         null::uuid, null::uuid, null::uuid,
         up.leaving_since, app.elapsed_hours(up.leaving_since, p_now), r.hours,
         jsonb_build_object('user_id', up.id, 'name', up.display_name,
                            'items', app.handover_item_counts(up.id), 'total', app.handover_item_total(up.id))
    from user_profiles up
    join tenant_escalation_rules r on r.tenant_id = up.tenant_id and r.kind = 'handover'
   where up.leaving_since is not null
     and up.is_active
     and app.elapsed_hours(up.leaving_since, p_now) >= r.hours
     and app.handover_item_total(up.id) > 0
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = up.tenant_id and l.kind = 'handover'
                        and l.subject_id = up.id and l.occurrence = up.leaving_since::text);
$function$;

CREATE OR REPLACE FUNCTION app.run_escalation_sweep(p_now timestamp with time zone DEFAULT now(), p_dry_run boolean DEFAULT false, p_kind text DEFAULT NULL::text, p_deliverable uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  r          app.escalation_due_row;
  v_people   jsonb;
  v_count    integer;
  v_log      uuid;
  v_type     text;
  v_sent     integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_fallback boolean;
  v_reason   text;
begin
  -- ADR-0133 d.4: a list emptied from the items' own pages (not the hand-over page) completes here too.
  if not p_dry_run then
    perform app.complete_finished_handovers();
  end if;

  for r in select * from app.escalation_due(p_now) e where (p_kind is null or e.kind = p_kind)
             and (p_deliverable is null or e.deliverable_id = p_deliverable)   -- [edit]
           order by e.kind, e.since, e.subject_id loop
    v_fallback := false;
    v_reason := null;
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
    elsif r.kind = 'handover' then
      -- ADR-0133 d.5: the rule's roles (default the Traffic Manager and the Power Admins), active and not leaving
      -- themselves, never the person leaving. The rule names no piece, so `escalation_recipients` does not apply.
      select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('role')) order by up.id), '[]'::jsonb)
        into v_people
        from user_profiles up
        join tenant_escalation_rules er on er.tenant_id = r.tenant_id and er.kind = 'handover'
       where up.tenant_id = r.tenant_id and up.role_id = any (er.role_ids)
         and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := 'no one holds the hand-over rule''s roles';
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.escalation_recipients(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id) x;

      -- I59 E9: a rule that resolves to nobody goes to the Traffic Manager role.
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := app.escalation_fallback_reason(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id);
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    end if;
    v_count := jsonb_array_length(v_people);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id, 'label', r.label,
      'occurrence', r.occurrence, 'since', r.since, 'hours', round(r.hours, 1), 'threshold', r.threshold,
      'recipients', v_people, 'extra', r.extra,
      'fallback', v_fallback, 'fallback_reason', v_reason));

    if p_dry_run then
      continue;
    end if;

    if v_count = 0 then
      -- Nobody at all, not even the Traffic Manager: nothing sent, retried next run — but recorded.
      insert into escalation_unreached (tenant_id, kind, subject_id, occurrence, reason, first_tried_at, last_tried_at)
      values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_reason, p_now, p_now)
      on conflict (tenant_id, kind, subject_id, occurrence)
      do update set last_tried_at = excluded.last_tried_at, reason = excluded.reason;
      continue;
    end if;

    v_log := null;
    insert into escalation_log (tenant_id, kind, subject_id, occurrence, recipients, sent_at, fallback, fallback_reason)
    values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_count, p_now, v_fallback, v_reason)
    on conflict (tenant_id, kind, subject_id, occurrence) do nothing
    returning id into v_log;
    if v_log is null then
      continue;   -- another run sent this cause first
    end if;

    delete from escalation_unreached u
     where u.tenant_id = r.tenant_id and u.kind = r.kind and u.subject_id = r.subject_id
       and u.occurrence = r.occurrence;

    v_type := case r.kind when 'review_remind' then 'review_reminder'
                          when 'over_capacity' then 'over_capacity'
                          else 'escalated' end;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, (p ->> 'user_id')::uuid, v_type, r.label, r.entity_type, r.entity_id, null,
           coalesce(r.extra, '{}'::jsonb) || jsonb_build_object(
             'kind', r.kind, 'occurrence', r.occurrence, 'since', r.since,
             'hours', case when r.hours is null then null else round(r.hours) end,
             'threshold', r.threshold, 'as', p -> 'reasons')
           || case when v_fallback then jsonb_build_object('fallback_reason', v_reason) else '{}'::jsonb end
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
end $function$;
