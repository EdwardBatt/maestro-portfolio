-- SJ-v3-04 (Figma `B · SINGLE JOB — BRIEF FIRST`, 22 Sep) — a deliverable has a PRIORITY.
--
-- Who and when asks High / Medium / Low. Edward, 22 Sep: *"priorities need to be added"* — to the
-- system, not only the job's record. The column is on `deliverables`: the single job's one
-- deliverable is what the department picks up, and every task of it, every My Work row and every
-- list reads the deliverable it belongs to. Nullable: a campaign's deliverables have no priority
-- until somebody sets one; nothing existing changes.
--
-- `app.write_campaign_content` — the ONE content writer (ADR-0067) — is reproduced whole from
-- 20260920100000 with the one column added, so the wizard's draft path and the one-shot path stay
-- one shape. The value arrives on the deliverable spec as `priority`, beside `channel` and `format`.

begin;

alter table deliverables
  add column if not exists priority text
  constraint chk_deliverables_priority check (priority is null or priority in ('high', 'medium', 'low'));

comment on column deliverables.priority is
  'SJ-v3-04 (22 Sep): High / Medium / Low, chosen by the account manager on who and when. Null '
  'where nobody set one. Read by the task list, My Work and the deliverables list.';

create or replace function app.write_campaign_content(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb,
  p_phases       jsonb default null
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name   text;
  v_kind   text;
  v_stream uuid;
  v_deliv  jsonb;
  v_phase  jsonb;
  v_id     uuid;
  v_over   jsonb;
  v_on     boolean := p_phases is not null and jsonb_typeof(p_phases) = 'array' and jsonb_array_length(p_phases) > 0;
  v_n      integer := 0;
  v_phase_end date;
begin
  update campaigns
     set brief       = p_brief,
         audience    = p_brief ->> 'audiencePrimary',
         insight     = p_brief ->> 'insight',
         proposition = p_brief ->> 'proposition',
         go_live_at  = p_go_live,
         has_phases  = v_on
   where id = p_campaign and tenant_id = v_tenant
  returning name, kind into v_name, v_kind;

  if v_name is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;

  -- The phases first, numbered in the order given (ADR-0096 d.2). Written as the campaign's
  -- creator is by definition its authority at this moment; the table has no write policy, so the
  -- insert runs as the definer below.
  if v_on then
    for v_phase in select * from jsonb_array_elements(p_phases)
    loop
      v_n := v_n + 1;
      perform app.insert_campaign_phase(
        v_tenant, p_campaign, v_n,
        v_phase ->> 'name',
        (v_phase ->> 'startsOn')::date,
        (v_phase ->> 'endsOn')::date);
    end loop;
  end if;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, p_campaign, v_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- owner_user_id is the only PERSON the Account Manager sets per row. department_id is stamped
    -- by `tg_deliverable_stamp_department` from that person, so it is deliberately not passed.
    insert into deliverables (
      tenant_id, stream_id, name, state, due_at, owner_user_id,
      deliverable_type_id, quantity, channel, format, phase_id, priority
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
      nullif(v_deliv ->> 'format', ''),
      case when v_on then
        (select p.id from campaign_phases p
          where p.campaign_id = p_campaign
            and p.number = nullif(v_deliv ->> 'phaseNumber', '')::int)
      end,
      -- SJ-v3-04 (20260922160000): the priority chosen on who and when rides on the row.
      nullif(v_deliv ->> 'priority', '')
    )
    returning id into v_id;

    -- I41.8 / ADR-0093 / ADR-0096 d.7: the person was shown a tight, impossible, after-go-live or
    -- after-phase-end warning and proceeded. Record it against the row that now exists.
    v_over := v_deliv -> 'dueDateOverride';
    if v_over is not null and jsonb_typeof(v_over) = 'object' then
      select p.ends_on into v_phase_end from campaign_phases p
       where p.campaign_id = p_campaign and p.number = nullif(v_deliv ->> 'phaseNumber', '')::int;
      perform app.record_due_date_override(
        v_id,
        (v_deliv ->> 'dueAt')::date,
        v_over ->> 'severity',
        (p_go_live at time zone 'UTC')::date,
        coalesce((v_over ->> 'workingDaysLeft')::int, 0),
        coalesce((v_over ->> 'requiredDays')::int, 0),
        nullif(v_over ->> 'outstandingHours', '')::numeric,
        nullif(v_over ->> 'capacityHours', '')::numeric,
        coalesce(v_over ->> 'boundary', 'go_live'),
        case when coalesce(v_over ->> 'boundary', 'go_live') = 'phase_end' then v_phase_end end);
    end if;
  end loop;
end $$;

commit;
