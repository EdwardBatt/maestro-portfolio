-- ADR-0093 (I48.24) — a date after go-live warns and is recorded; nowhere is it refused.
--
-- Edward, 14 Sep: *"The message should advise the user that the proposed new date exceeds the
-- scheduled go-live date, and that they should seek the approval of the client. Show the warning
-- and allow the users to proceed and ensuring the action is recorded in the audit logs."* — and,
-- asked whether that holds at all three doors (the promised-date dialog, the campaign wizard, the
-- extension request): yes to all three.
--
-- WHAT WAS THERE. ADR-0075 d.9 made a date after go-live "the one refusal", and it was enforced in
-- three functions. The automated retest (K6b) found the first of them refusing the go-live DAY
-- itself: `deliverable_due_at_change` compared 18:00 Iraq on the day with `go_live_at` as a moment
-- (the wizard stores midnight UTC = 03:00 Iraq), so the screen said "impossible — if you proceed
-- the override is recorded" and the database said "after the campaign goes live". Fixing the
-- comparison was one option; Edward chose the other — the system warns everywhere and refuses
-- nowhere, which is the philosophy ADR-0075 d.9 itself stated for every other date.
--
-- WHAT CHANGES. Four functions, each REPRODUCED WHOLE from its latest definition (the house
-- pattern for `create or replace`, so the search_path pin and every other line survive):
--   * public.sub_task_extension_request   (20260911122000) — the go-live refusal removed;
--   * public.deliverable_due_at_change    (20260911122000) — the go-live refusal removed;
--   * app.record_due_date_override + its public wrapper (20260913170000) — `after_go_live` joins
--     the severities an override may carry, so the record says what the person was shown;
--   * app.write_campaign_content          (20260913170000) — the go-live refusal removed.
-- Nothing else in any of them is touched. The audit trail is unchanged in shape: the override row
-- (`due_date_override`, ADR-0075 d.9) and the universal audit trigger.
--
-- Tests: supabase/tests/101 (the d.7 refusal becomes lives_ok) and 112 (the wizard accepts, and
-- records, a date after go-live).

begin;

-- ============================================================================
-- 1) asking for an extension past go-live is allowed; the approver decides
-- ============================================================================
create or replace function public.sub_task_extension_request(
  p_sub_task      uuid,
  p_to_day        date,
  p_reason        text,
  p_attributed_to text
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := auth.uid();
  v          sub_tasks%rowtype;
  v_to       timestamptz;
  v_pending  uuid;
  v_approver uuid;
  v_id       uuid := gen_random_uuid();
  v_w        text;   -- app.sla_event_writer, saved and restored (review, 11 Sep)
begin
  -- `for update`: pending is derived from the log (d.5), so two concurrent requests would both
  -- become pending without a lock on the task (review, 11 Sep). One lock, the same shape as
  -- maybe_complete_sub_task.
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant for update;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  if not app.sub_task_can_request_extension(p_sub_task) then
    raise exception 'only the task''s assignee, or somebody who could reschedule it, can ask for an extension'
      using errcode = '42501';
  end if;
  if v.status in ('done', 'cancelled') then
    raise exception 'this task is finished; there is no deadline left to extend' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'say why the extension is needed — the approver decides on it' using errcode = '22023';
  end if;
  if p_attributed_to is null or p_attributed_to not in ('assignee', 'client', 'dependency') then
    raise exception 'say who the time is charged to: assignee, client or dependency' using errcode = '22023';
  end if;
  if p_to_day is null then
    raise exception 'a new deadline is required' using errcode = '22023';
  end if;

  v_to := app.close_of_day(p_to_day);
  if v.committed_due_at is not null and v_to <= v.committed_due_at then
    raise exception 'an extension moves the deadline later than the current commitment' using errcode = '22023';
  end if;
  -- ADR-0093: a date after the campaign's go-live is no longer refused here. The screen warns,
  -- the request is sent, and the account manager — who decides every extension (ADR-0088 d.4) —
  -- weighs it with the client's agreement in hand.

  -- d.5: one pending request per task — a new one supersedes the old, and both rows survive.
  select request_id into v_pending
    from public.sub_task_extension_requests r where r.sub_task_id = p_sub_task
   order by created_at desc limit 1;
  if v_pending is not null then
    v_w := coalesce(current_setting('app.sla_event_writer', true), '');
    perform set_config('app.sla_event_writer', 'on', true);
    insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
    values (v_tenant, v.deliverable_id, v.id, 'extension_withdrawn', v_actor,
            jsonb_build_object('request_id', v_pending, 'superseded_by', v_id));
    perform set_config('app.sla_event_writer', v_w, true);
  end if;

  v_approver := app.sub_task_extension_approver(p_sub_task);

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (id, tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_id, v_tenant, v.deliverable_id, v.id, 'extension_requested', p_attributed_to::attribution_party,
          v_actor,
          jsonb_build_object('from', v.committed_due_at, 'to', v_to, 'reason', trim(p_reason),
                             'approver_user_id', v_approver));
  perform set_config('app.sla_event_writer', v_w, true);

  -- d.9: the resolved approver only, and never the actor about their own act.
  if v_approver is not null and v_approver <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v_tenant, v_approver, 'extension_requested', v.title, 'sub_task', v.id, v_actor);
  end if;

  return v_id;
end $$;

comment on function public.sub_task_extension_request(uuid, date, text, text) is
  'ADR-0088 d.2/d.4/d.5: ask for a task''s committed deadline to move to 18:00 Iraq on p_to_day, '
  'with a mandatory reason and an attribution (assignee | client | dependency). Supersedes a pending '
  'request. Notifies the resolved approver. Returns the request id (its sla_events row). ADR-0093: '
  'a date after go-live is asked for like any other; the approver decides.';

revoke execute on function public.sub_task_extension_request(uuid, date, text, text) from public, anon;
grant  execute on function public.sub_task_extension_request(uuid, date, text, text) to authenticated;

-- ============================================================================
-- 6) withdrawing (d.5) — the requester, or anyone who could have asked
-- ============================================================================

-- ============================================================================
-- 2) the promised date may move past go-live, on evidence, and is recorded
-- ============================================================================
create or replace function public.deliverable_due_at_change(
  p_deliverable    uuid,
  p_due_day        date,
  p_evidence_asset uuid,
  p_note           text default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := auth.uid();
  d          deliverables%rowtype;
  v_campaign uuid;
  v_to       timestamptz;
  v_prior    text;
  v_id       uuid;
  v_w        text;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;

  select s.campaign_id into v_campaign
    from streams s
   where s.id = d.stream_id;
  if v_campaign is null then
    raise exception 'this deliverable has no client behind its date; edit it directly' using errcode = '22023';
  end if;
  if d.state = 'archived' then
    raise exception 'an archived deliverable has no date to change' using errcode = '22023';
  end if;

  -- d.7a: "via the AM for now" — the account manager by scope, the same gate as the campaign's.
  if not (app.has_permission('projects', 'manage')
          and app.in_write_scope(null, null, app.deliverable_account_manager(p_deliverable))) then
    raise exception 'only the campaign''s account manager can change the promised date'
      using errcode = '42501';
  end if;

  -- No attachment, no change. The evidence is an asset filed in THIS campaign's folders.
  if p_evidence_asset is null or not exists (
       select 1 from assets a join asset_folders f on f.id = a.folder_id
        where a.id = p_evidence_asset and a.tenant_id = v_tenant and f.campaign_id = v_campaign) then
    raise exception 'attach the client''s agreement first — a date changes on evidence, as it was set on evidence'
      using errcode = '22023';
  end if;

  if p_due_day is null then
    raise exception 'a new date is required' using errcode = '22023';
  end if;
  v_to := app.close_of_day(p_due_day);
  if v_to is not distinct from d.due_at then
    raise exception 'that is already the promised date' using errcode = '22023';
  end if;
  -- ADR-0093: a date after go-live is not refused. The dialog says it is after go-live and that
  -- the client's agreement is needed; the evidence requirement above is that agreement, and the
  -- override row (record_due_date_override, severity after_go_live) is the record of proceeding.

  v_prior := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  perform set_config('app.deliverable_due_at_change', 'on', true);
  update deliverables set due_at = v_to where id = p_deliverable;
  perform set_config('app.deliverable_due_at_change', v_prior, true);

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values (v_tenant, p_deliverable, 'deadline_changed', 'client', v_actor,
          jsonb_build_object('from', d.due_at, 'to', v_to, 'evidence_asset_id', p_evidence_asset,
                             'note', nullif(trim(coalesce(p_note, '')), '')))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);
  return v_id;
end $$;

comment on function public.deliverable_due_at_change(uuid, date, uuid, text) is
  'ADR-0088 d.7a: the ONE route by which a live deliverable''s promised date changes. The account '
  'manager by scope, with an evidence asset filed in the campaign''s folders, to 18:00 Iraq on the '
  'day. A date after go-live warns on the screen and is recorded (ADR-0093), never refused. Logged '
  'as deadline_changed attributed to the client.';

revoke execute on function public.deliverable_due_at_change(uuid, date, uuid, text) from public, anon;
grant  execute on function public.deliverable_due_at_change(uuid, date, uuid, text) to authenticated;

-- ============================================================================
-- 3) the override record learns the third severity
-- ============================================================================
create or replace function app.record_due_date_override(
  p_deliverable   uuid,
  p_due_day       date,
  p_severity      text,
  p_go_live_day   date,
  p_days_left     integer,
  p_required_days integer,
  p_outstanding_hours numeric default null,
  p_capacity_hours    numeric default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
begin
  -- ADR-0093 adds after_go_live: the date is past the campaign's go-live and the person proceeded.
  if p_severity not in ('tight', 'impossible', 'after_go_live') then
    raise exception using errcode = 'check_violation',
      message = 'an override is recorded only for a tight, impossible or after-go-live date';
  end if;
  if not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    raise exception 'deliverable_not_found' using errcode = 'no_data_found';
  end if;
  insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id, payload)
  values (v_tenant, p_deliverable, 'due_date_override', auth.uid(),
          jsonb_build_object(
            'due_day', p_due_day,
            'go_live_day', p_go_live_day,
            'severity', p_severity,
            'working_days_left', p_days_left,
            'required_days', p_required_days,
            'outstanding_hours', p_outstanding_hours,
            'capacity_hours', p_capacity_hours))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.record_due_date_override(
  p_deliverable   uuid,
  p_due_day       date,
  p_severity      text,
  p_go_live_day   date,
  p_days_left     integer,
  p_required_days integer,
  p_outstanding_hours numeric default null,
  p_capacity_hours    numeric default null
) returns uuid
language sql
security invoker
set search_path = public, app, extensions as $$
  select app.record_due_date_override(p_deliverable, p_due_day, p_severity, p_go_live_day,
                                      p_days_left, p_required_days, p_outstanding_hours, p_capacity_hours);
$$;

comment on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) is
  'ADR-0075 d.9 / I41.8 / ADR-0093: the record of a person proceeding past a tight, impossible or '
  'after-go-live due-date warning. '
  'An unrecorded warning is a click; this row is what makes a pattern visible.';

revoke execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) from public, anon;
grant  execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) to authenticated;
revoke execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) from public;
grant  execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) to authenticated;

-- ============================================================================
-- 4) the wizard accepts a due date after go-live and records the override
-- ============================================================================
create or replace function app.write_campaign_content(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name   text;
  v_stream uuid;
  v_deliv  jsonb;
  v_id     uuid;
  v_over   jsonb;
begin
  update campaigns
     set brief       = p_brief,
         audience    = p_brief ->> 'audiencePrimary',
         insight     = p_brief ->> 'insight',
         proposition = p_brief ->> 'proposition',
         go_live_at  = p_go_live
   where id = p_campaign and tenant_id = v_tenant
  returning name into v_name;

  if v_name is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, p_campaign, v_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- ADR-0093: a due date after go-live is no longer refused here. The wizard warns, the account
    -- manager proceeds knowingly, and the override rides in `dueDateOverride` below like the tight
    -- and impossible cases.

    -- owner_user_id is the only PERSON the Account Manager sets per row. department_id is stamped
    -- by `tg_deliverable_stamp_department` from that person, so it is deliberately not passed.
    insert into deliverables (
      tenant_id, stream_id, name, state, due_at, owner_user_id,
      deliverable_type_id, quantity, channel, format
    )
    values (
      v_tenant,
      v_stream,
      v_deliv ->> 'name',
      'draft',
      nullif(v_deliv ->> 'dueAt', '')::timestamptz,
      nullif(v_deliv ->> 'ownerUserId', '')::uuid,
      (select dt.id from deliverable_types dt
        where dt.id = nullif(v_deliv ->> 'deliverableTypeId', '')::uuid
          and dt.tenant_id = v_tenant),
      greatest(coalesce(nullif(v_deliv ->> 'quantity', '')::int, 1), 1),
      nullif(v_deliv ->> 'channel', ''),
      nullif(v_deliv ->> 'format', '')
    )
    returning id into v_id;

    -- I41.8 / ADR-0093: the person was shown a tight, impossible or after-go-live warning and proceeded. Record it against the
    -- row that now exists, in the same transaction that created it.
    v_over := v_deliv -> 'dueDateOverride';
    if v_over is not null and jsonb_typeof(v_over) = 'object' then
      perform app.record_due_date_override(
        v_id,
        (v_deliv ->> 'dueAt')::date,
        v_over ->> 'severity',
        (p_go_live at time zone 'UTC')::date,
        coalesce((v_over ->> 'workingDaysLeft')::int, 0),
        coalesce((v_over ->> 'requiredDays')::int, 0),
        nullif(v_over ->> 'outstandingHours', '')::numeric,
        nullif(v_over ->> 'capacityHours', '')::numeric);
    end if;
  end loop;
end $$;

commit;
