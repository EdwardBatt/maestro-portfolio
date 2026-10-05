-- I41.8 (ADR-0075 d.9) — a due date inside the delivery window WARNS, states the damage, and is
-- allowed; the override is RECORDED. Only a date after go-live is refused.
--
-- Edward, 9 Sep: *"the philosophy of the system is non-blocking… allow to proceed after warning and
-- record override."* Until now nothing anywhere compared a deliverable's due date to its campaign's
-- go-live: a date typed one day before go-live drew no objection, and the word "least" in "at least
-- 2 days" was unpoliced. The arithmetic is done in the browser (`lib/campaigns/go-live-dates.ts`,
-- `classifyDueDate`) because it is presentation — the warning is what the person reads. What the
-- database owns is the RECORD: an unrecorded warning is a click. `sla_events` takes the row — who
-- overrode, when, the date they chose, and which severity they were shown — so a pattern of
-- impossible dates accepted is visible per person and per client (d.8's principle applied to
-- dates).
--
-- Two paths write it:
--   * `record_due_date_override` — the due-date dialog on an existing deliverable (ADR-0088 d.7a);
--   * `app.write_campaign_content` — the campaign wizard, where the deliverable does not exist
--     until submit, so the override travels INSIDE the deliverable's JSON and is written by the
--     same statement that creates the row. Reproduced whole from 20260903100100 (its only
--     definition); the one addition is the block after the insert.
--
-- The refusal (a due date after go-live) is enforced here too, for the wizard path — the screen
-- says it first, this makes it true when the screen is bypassed.
--
-- Tests: supabase/tests/112_a_due_date_override_is_recorded.sql

begin;

-- ============================================================================
-- 1) the event type
-- ============================================================================
-- Reproduced from 20260911122000_a_deadline_is_extended_by_asking.sql, plus one value.
alter table sla_events drop constraint sla_events_event_type_check;
alter table sla_events add constraint sla_events_event_type_check
  check (event_type in (
    'deadline_set', 'deadline_changed', 'scope_change',
    'clock_paused', 'clock_resumed',
    'blocked_flagged', 'block_cleared',
    'delivered', 'revision_requested', 'approved',
    -- ADR-0088 d.5
    'extension_requested', 'extension_withdrawn', 'extension_approved', 'extension_refused',
    -- ADR-0075 d.9 / I41.8
    'due_date_override'
  ));

-- ============================================================================
-- 2) the record, callable on an existing deliverable
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
  if p_severity not in ('tight', 'impossible') then
    raise exception using errcode = 'check_violation',
      message = 'an override is recorded only for a tight or impossible date';
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
  'ADR-0075 d.9 / I41.8: the record of a person proceeding past a tight/impossible due-date warning. '
  'An unrecorded warning is a click; this row is what makes a pattern visible.';

revoke execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) from public, anon;
grant  execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) to authenticated;
revoke execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) from public;
grant  execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric) to authenticated;

-- ============================================================================
-- 3) the wizard path — the override rides inside the deliverable JSON
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
    -- ADR-0075 d.9: a due date AFTER go-live is the one refusal. Not a tight deadline but a typing
    -- mistake — the client would receive the work after they have used it.
    if p_go_live is not null
       and nullif(v_deliv ->> 'dueAt', '') is not null
       and (v_deliv ->> 'dueAt')::date > (p_go_live at time zone 'UTC')::date then
      raise exception using errcode = 'check_violation',
        message = format('"%s" is due after the campaign goes live', v_deliv ->> 'name');
    end if;

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

    -- I41.8: the person was shown a tight/impossible warning and proceeded. Record it against the
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
