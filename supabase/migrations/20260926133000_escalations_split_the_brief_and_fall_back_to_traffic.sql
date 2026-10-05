-- I59.31 / E8, E9, the four hooks, and the settled single-job clock (Edward, 25 Sep) — ADR-0108's sweep
-- completed.
--
--   E8  Escalation row 2 SPLITS. 'task_list' = a piece's task list waiting on its OWNER (Traffic
--       Manager + the account manager, 24h — the row as seeded). New kind 'campaign_brief' = a campaign
--       / brief waiting on the ACCOUNT MANAGER's approval (Traffic Manager + the Account Director role,
--       24h). Seeded for every tenant now and, through app.seed_tenant_escalation_rules (reproduced
--       whole, called by the provisioning wrapper — not changed), for every tenant created later. The
--       brief-waiting rung of 20260926122000 is routed to 'campaign_brief'; its causes already logged
--       under 'task_list' are re-keyed so none is sent twice.
--   E9  An escalation whose rule resolves to NOBODY goes to the Traffic Manager role (key
--       'scheduler'): its active holders, `detail.fallback_reason` saying why ("no department lead for
--       Creative"), `detail.as = ['traffic_fallback']`. The log records it (`escalation_log.fallback`,
--       `fallback_reason`). When even the Traffic Manager role has nobody, nothing is sent and the cause
--       is retried next run (as before) — and recorded in `escalation_unreached`, so it is not silent.
--       `public.escalation_rules_reaching_nobody()` — admin (organization:manage) — lists the rule kinds
--       that resolved to nobody in the last 7 days: how often, when last, why, and whether even the
--       fallback found nobody. For the settings screen.
--   hooks  The four rungs Track 3 left marked HOOK, all in REAL time (ADR-0108 d.1), keyed in
--       escalation_log by (kind, the request / input id, ''):
--         change_request   a change request still `pending` (its owner has not answered) — from `created_at` (sent)
--         extension_owner  an extension request at the OWNER's step — from its `extension_requested` row (asked)
--         extension_am     an extension request at the ACCOUNT MANAGER's step — from the owner's forward;
--                          a request whose owner step was skipped (owner = approver, no owner, or the
--                          owner asked) is at that step from the moment it was asked, so its clock
--                          starts then (listed as a question)
--         blocked          a maker's task-level input not cleared (`satisfied_at` null) on an open task —
--                          from `requested_at`
--       `app.escalation_cause_open` answers each (an escalation leaves Needs you once its stall ends).
--   settled  A single job's 'unassigned' clock starts at its task list's approval
--       (`deliverables.tasks_approved_at`), like a campaign piece's — no longer at the job's release.
--
-- Reproduced WHOLE from their latest definitions (grep confirmed 26 Sep):
--   tenant_escalation_rules kind check        (20260926120000) — plus 'campaign_brief';
--   app.seed_tenant_escalation_rules          (20260926120000) — plus the campaign_brief row;
--   app.escalation_due                        (20260926122000) — the split, the clock, the hooks;
--   app.run_escalation_sweep                  (20260926122000) — the Traffic fallback;
--   app.escalation_cause_open                 (20260926122000) — the new kinds.
--
-- Tests: supabase/tests/177_escalations_split_the_brief_and_fall_back_to_traffic.sql

begin;

-- ---------------------------------------------------------------- the kind ----
alter table tenant_escalation_rules drop constraint chk_tenant_escalation_rules_kind;
alter table tenant_escalation_rules add constraint chk_tenant_escalation_rules_kind check (kind in (
  'unassigned', 'task_list', 'campaign_brief', 'change_request', 'extension_owner', 'extension_am',
  'blocked', 'review_remind', 'review_escalate'));

-- ---------------------------------------------------------------- the defaults ----
create or replace function app.seed_tenant_escalation_rules(p_tenant uuid) returns void
language plpgsql
set search_path = public, app, extensions as $$
declare
  v_traffic uuid := (select id from roles where tenant_id = p_tenant and key = 'scheduler');
  v_ad      uuid := (select id from roles where tenant_id = p_tenant and key = 'account_director');
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
    (p_tenant, 'review_escalate', 48,      '{}',                                  array['account_manager', 'owner'])
  on conflict (tenant_id, kind) do nothing;
end $$;

comment on function app.seed_tenant_escalation_rules(uuid) is
  'ADR-0108 d.2 + I59 E8: the nine default escalation rows for a tenant (task_list and campaign_brief '
  'split). `on conflict do nothing` — a tenant''s own edits are never overwritten. Called by the '
  'provisioning wrapper after the Account Director seed (it names that role).';

select app.seed_tenant_escalation_rules(id) from tenants;

-- The brief causes the sweep already sent under 'task_list' are the new kind's (never sent twice).
update escalation_log l set kind = 'campaign_brief'
 where l.kind = 'task_list'
   and exists (select 1 from campaigns c where c.id = l.subject_id)
   and not exists (select 1 from escalation_log x
                    where x.tenant_id = l.tenant_id and x.kind = 'campaign_brief'
                      and x.subject_id = l.subject_id and x.occurrence = l.occurrence);

-- ---------------------------------------------------------------- the fallback's record ----
alter table escalation_log
  add column if not exists fallback boolean not null default false,
  add column if not exists fallback_reason text;

comment on column escalation_log.fallback is
  'I59 E9: the rule resolved to nobody, so the escalation went to the Traffic Manager role instead.';
comment on column escalation_log.fallback_reason is
  'I59 E9: why the rule resolved to nobody ("no department lead for Creative").';

create table escalation_unreached (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  kind          text not null,
  subject_id    uuid not null,
  occurrence    text not null default '',
  reason        text,
  first_tried_at timestamptz not null default now(),
  last_tried_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  constraint uq_escalation_unreached_cause unique (tenant_id, kind, subject_id, occurrence)
);

create index idx_escalation_unreached_tenant_id on escalation_unreached (tenant_id);

comment on table escalation_unreached is
  'I59 E9: a due escalation whose rule AND the Traffic Manager fallback resolved to nobody — nothing '
  'was sent; the sweep retries it every run and keeps this row current until it is sent (then the row '
  'is removed). Read by escalation_rules_reaching_nobody. Written only by the sweep.';

alter table escalation_unreached enable row level security;
alter table escalation_unreached force row level security;

create policy escalation_unreached_admin_select on escalation_unreached
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));
-- No insert/update/delete policy: the sweep (security definer) is the only writer.
revoke insert, update, delete on escalation_unreached from authenticated, anon;

create trigger set_updated_at before update on escalation_unreached
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on escalation_unreached
  for each row execute function app.set_actor_columns();
create trigger audit_row_change after insert or update or delete on escalation_unreached
  for each row execute function app.audit_row_change();

-- ---------------------------------------------------------------- why nobody ----
-- The rule's own parts, each said as the absence it is. Called only when the rule resolved to nobody,
-- so every part it names is missing; the words say which.
create or replace function app.escalation_fallback_reason(
  p_kind        text,
  p_deliverable uuid,
  p_sub_task    uuid,
  p_campaign    uuid default null
) returns text
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v_deliverable uuid := p_deliverable;
  v_campaign    uuid := p_campaign;
  v_tenant      uuid;
  v_rule        tenant_escalation_rules;
  v_name        text;
  v_owner       uuid;
  v_dept        uuid;
  v_team        uuid;
  v_parts       text[] := array[]::text[];
  v_rel         text;
begin
  if v_deliverable is null and p_sub_task is not null then
    select t.deliverable_id into v_deliverable from sub_tasks t where t.id = p_sub_task;
  end if;
  if v_deliverable is not null then
    select d.tenant_id, d.name, d.owner_user_id, coalesce(own.department_id, d.department_id),
           coalesce(v_campaign, s.campaign_id, j.campaign_id)
      into v_tenant, v_name, v_owner, v_dept, v_campaign
      from deliverables d
      left join user_profiles own on own.id = d.owner_user_id
      left join streams s on s.id = d.stream_id
      left join jobs j on j.id = d.job_id
     where d.id = v_deliverable;
  elsif v_campaign is not null then
    select c.tenant_id, c.name into v_tenant, v_name from campaigns c where c.id = v_campaign;
  end if;
  select * into v_rule from tenant_escalation_rules r where r.tenant_id = v_tenant and r.kind = p_kind;
  if v_rule.id is null then
    return 'the tenant has no rule for this escalation';
  end if;

  if cardinality(v_rule.role_ids) > 0 then
    v_parts := v_parts || ('nobody active holds ' || coalesce(
      (select string_agg(ro.name, ', ' order by ro.name) from roles ro
        where ro.id = any (v_rule.role_ids) and ro.tenant_id = v_tenant), 'the rule''s roles'));
  end if;

  foreach v_rel in array v_rule.relative loop
    if v_rel = 'owner' then
      v_parts := v_parts || ('no owner on ' || coalesce(v_name, 'the piece'));
    elsif v_rel = 'account_manager' then
      v_parts := v_parts || ('no account manager on ' || coalesce(
        (select c.name from campaigns c where c.id = v_campaign), v_name, 'the piece'));
    elsif v_rel = 'owner_department_lead' then
      v_parts := v_parts || case when v_dept is null then 'no department on the owner'
        else 'no department lead for ' || coalesce((select x.name from departments x where x.id = v_dept), 'the department') end;
    elsif v_rel = 'assignee_team_lead' then
      select au.team_id into v_team
        from sub_tasks t join user_profiles au on au.id = t.assignee_id where t.id = p_sub_task;
      v_parts := v_parts || case when v_team is null then 'the assignee has no team'
        else 'no team lead for ' || coalesce((select x.name from teams x where x.id = v_team), 'the team') end;
    elsif v_rel = 'reviewers' then
      v_parts := v_parts || 'no reviewer is waiting to answer'::text;
    end if;
  end loop;

  if cardinality(v_parts) = 0 then
    return 'the rule names nobody';
  end if;
  return array_to_string(v_parts, '; ');
end $$;

revoke execute on function app.escalation_fallback_reason(text, uuid, uuid, uuid) from public, anon, authenticated;
grant  execute on function app.escalation_fallback_reason(text, uuid, uuid, uuid) to service_role;

comment on function app.escalation_fallback_reason(text, uuid, uuid, uuid) is
  'I59 E9: why an escalation rule resolved to nobody, in words ("no department lead for Creative; '
  'nobody active holds Account Director"). Read by the sweep for detail.fallback_reason.';

-- ---------------------------------------------------------------- the due set ----
create or replace function app.escalation_due(p_now timestamptz default now())
returns setof app.escalation_due_row
language sql stable security definer
set search_path = public, app, extensions as $$
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
$$;

revoke execute on function app.escalation_due(timestamptz) from public, anon, authenticated;
grant  execute on function app.escalation_due(timestamptz) to service_role;

comment on function app.escalation_due(timestamptz) is
  'ADR-0108 (I59.24, I59.31): every stall that is due for escalation at p_now and not yet sent — the ONE '
  'due set the live sweep and the dry run both read. Rungs: unassigned (from the task list''s approval), '
  'task_list, campaign_brief, review_remind, review_escalate, over_capacity, change_request, '
  'extension_owner, extension_am, blocked. Real-time hours throughout (d.1).';

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
  for r in select * from app.escalation_due(p_now) e where p_kind is null or e.kind = p_kind
           order by e.kind, e.since, e.subject_id loop
    v_fallback := false;
    v_reason := null;
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
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
end $$;

revoke execute on function app.run_escalation_sweep(timestamptz, boolean, text) from public, anon, authenticated;
grant  execute on function app.run_escalation_sweep(timestamptz, boolean, text) to service_role;

comment on function app.run_escalation_sweep(timestamptz, boolean, text) is
  'ADR-0108 / ADR-0045 d.1 (I59.24, I59.31): the stall sweep. For each due cause (app.escalation_due) '
  'resolves the recipients — falling back to the Traffic Manager role (detail.fallback_reason) when the '
  'rule resolves to nobody (E9) — logs the cause in escalation_log FIRST (once per cause, race-safe), then '
  'notifies: `escalated` (detail.kind), `review_reminder` for review_remind, `over_capacity` for overload. '
  'A cause nobody at all can hear is recorded in escalation_unreached and retried. p_dry_run lists every '
  'due cause with its recipients and sends nothing. Returns {sent, due, items}.';

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
    -- 'task_list' on a campaign: escalations sent before the split (E8) read as the brief they were.
    when p_kind = 'campaign_brief' or (p_kind = 'task_list' and p_entity_type = 'campaign') then exists (
      select 1 from campaigns c where c.id = p_entity_id and c.status = 'pending_approval')
    when p_kind = 'task_list' then exists (
      select 1 from deliverables d
       where d.id = p_entity_id and d.tasks_approved_at is null and d.state <> 'archived')
    when p_kind in ('review_remind', 'review_escalate') then exists (
      select 1 from sub_tasks t
       where t.id = p_entity_id and t.status = 'review' and t.revision_number::text = p_occurrence
         and exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = t.id
                       and rv.approved_at is null and rv.responded_at is null))
    -- one open change request per deliverable (uq_deliverable_change_requests_open): still pending?
    when p_kind = 'change_request' then exists (
      select 1 from deliverable_change_requests q
       where q.deliverable_id = p_entity_id and q.status = 'pending')
    -- one pending extension request per task (ADR-0088 d.5): still at that step?
    when p_kind = 'extension_owner' then exists (
      select 1 from public.sub_task_extension_requests x
       where x.sub_task_id = p_entity_id and x.stage = 'owner')
    when p_kind = 'extension_am' then exists (
      select 1 from public.sub_task_extension_requests x
       where x.sub_task_id = p_entity_id and x.stage = 'am')
    when p_kind = 'blocked' then exists (
      select 1 from deliverable_pending_inputs pin join sub_tasks t on t.id = pin.sub_task_id
       where pin.sub_task_id = p_entity_id and pin.satisfied_at is null
         and t.status not in ('done', 'cancelled'))
    else true
  end;
$$;

comment on function app.escalation_cause_open(text, text, uuid, text) is
  'ADR-0108 (I59.24, I59.31): is the stall behind an escalation still there? Read by needs_me_escalations '
  'under the caller''s RLS, for every kind the sweep sends. An unknown kind reads as open.';

-- ---------------------------------------------------------------- reaches nobody ----
create or replace function public.escalation_rules_reaching_nobody()
returns table (
  kind            text,
  fell_back       integer,        -- sent to the Traffic Manager instead, in the last 7 days
  unreached       integer,        -- not even the Traffic Manager, still being retried
  last_at         timestamptz,
  reasons         text[]
)
language plpgsql stable security invoker
set search_path = public, app, extensions as $$
begin
  if not app.has_permission('organization', 'manage') then
    raise exception 'only an administrator sees which escalations reach nobody' using errcode = '42501';
  end if;
  return query
  with f as (
    select l.kind, count(*)::int as n, max(l.sent_at) as last_at,
           array_agg(distinct l.fallback_reason) filter (where l.fallback_reason is not null) as reasons
      from escalation_log l
     where l.tenant_id = app.current_tenant_id() and l.fallback
       and l.sent_at >= now() - interval '7 days'
     group by l.kind
  ), u as (
    select x.kind, count(*)::int as n, max(x.last_tried_at) as last_at,
           array_agg(distinct x.reason) filter (where x.reason is not null) as reasons
      from escalation_unreached x
     where x.tenant_id = app.current_tenant_id()
       and x.last_tried_at >= now() - interval '7 days'
     group by x.kind
  )
  select coalesce(f.kind, u.kind), coalesce(f.n, 0), coalesce(u.n, 0),
         greatest(f.last_at, u.last_at),
         (select array_agg(distinct z order by z)
            from unnest(coalesce(f.reasons, '{}') || coalesce(u.reasons, '{}')) z)
    from f full join u on u.kind = f.kind
   order by 1;
end $$;

revoke execute on function public.escalation_rules_reaching_nobody() from public, anon;
grant  execute on function public.escalation_rules_reaching_nobody() to authenticated;

comment on function public.escalation_rules_reaching_nobody() is
  'I59 E9: for the escalation settings screen (organization:manage) — each rule kind that resolved to '
  'nobody in the last 7 days: how often it fell back to the Traffic Manager, how many causes even the '
  'fallback could not reach (still retried), when last, and why. Security invoker over admin-only tables.';

commit;
