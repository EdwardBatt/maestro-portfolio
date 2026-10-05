-- A piece's date can be marked as given to the client (I56.11, Q4 — Figma CB-v3-04).
--
-- The timing step lets the account manager say "this date has been told to the client". Edward's
-- answer to Q4 was that it is a MARKER only: no second date, no evidence, nothing it blocks. So it
-- is one boolean on the deliverable, false unless somebody sets it, and the wizard's one content
-- writer (ADR-0067) learns to write it. The wizard carried the toggle from 24 Sep with nowhere to
-- put it — pressing it did nothing, which is worse than not offering it.
--
-- ADDITIVE ONLY. The column has a default, and a payload without `isGivenToClient` writes false —
-- pgTAP 102's positional call, the seed, and the single-job path are unchanged.
--
-- No policy change: the column sits on `deliverables`, whose row policies and audit trigger already
-- cover every column on it.

begin;

alter table deliverables
  add column if not exists is_given_to_client boolean not null default false;

comment on column deliverables.is_given_to_client is
  'I56.11 (Q4): the due date has been told to the client. A marker only — no second date, no '
  'evidence, and it gates nothing.';

-- ============================================================================
-- 3) the one content writer (ADR-0067), reproduced whole
-- ============================================================================
-- Reproduced rather than patched, for the reason it has been every time: it is the ONE place the
-- brief, the phases, the stream and the deliverables are written, and the one-shot path and the
-- draft path must not be able to disagree about any of them.
drop function if exists app.write_campaign_content(uuid, jsonb, timestamptz, jsonb, jsonb);

create or replace function app.write_campaign_content(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb,
  p_phases       jsonb default null,
  p_workstreams  jsonb default null
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
  v_ws     jsonb;
  v_id     uuid;
  v_over   jsonb;
  v_on     boolean := p_phases is not null and jsonb_typeof(p_phases) = 'array' and jsonb_array_length(p_phases) > 0;
  v_n      integer := 0;
  v_phase_end date;
  -- The wizard's draft ids to the rows they became. Key -> id as text; jsonb because a plpgsql
  -- variable is the only place this needs to exist — the keys are the client's own and are never
  -- stored.
  v_ws_map jsonb := '{}'::jsonb;
  v_ws_key text;
  v_ws_id  uuid;
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
  -- insert runs as the definer above.
  if v_on then
    for v_phase in select * from jsonb_array_elements(p_phases)
    loop
      v_n := v_n + 1;
      perform app.insert_campaign_phase(
        v_tenant, p_campaign, v_n,
        v_phase ->> 'name',
        (v_phase ->> 'startsOn')::date,
        (v_phase ->> 'endsOn')::date,
        -- I56.10: null where the phase simply ends on its date.
        nullif(v_phase ->> 'endsOnEvent', ''));
    end loop;
  end if;

  -- Then the groups (ADR-0099 d.1), because a deliverable names one on the way in: its department
  -- and the letters of its code are both taken from the group by triggers on the INSERT itself.
  if p_workstreams is not null and jsonb_typeof(p_workstreams) = 'array' then
    for v_ws in select * from jsonb_array_elements(p_workstreams)
    loop
      v_ws_key := v_ws ->> 'key';
      if v_ws_key is null or btrim(v_ws_key) = '' then
        raise exception 'every workstream in the payload needs a key' using errcode = '22023';
      end if;
      v_ws_id := app.insert_campaign_workstream(
        p_campaign,
        v_ws ->> 'name',
        nullif(v_ws ->> 'departmentId', '')::uuid,
        nullif(v_ws ->> 'ownerUserId', '')::uuid);
      v_ws_map := v_ws_map || jsonb_build_object(v_ws_key, v_ws_id::text);
    end loop;
  end if;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, p_campaign, v_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- ADR-0099 d.1: no key means ungrouped, which is legal and permanent. A key that names no
    -- group is a different thing — a payload that contradicts itself — and is refused by name
    -- rather than silently dropping the grouping the person asked for.
    v_ws_key := nullif(v_deliv ->> 'workstreamKey', '');
    v_ws_id  := nullif(v_ws_map ->> v_ws_key, '')::uuid;
    if v_ws_key is not null and v_ws_id is null then
      raise exception '"%" names a workstream that was not created with this campaign.',
        coalesce(v_deliv ->> 'name', v_ws_key) using errcode = '22023';
    end if;

    -- department_id is still not passed: `app.tg_deliverable_stamp_department` takes it from the
    -- workstream when there is one (ADR-0099 d.3) and from the owner, once, when there is not
    -- (`20260923190000`). One rule, in one place.
    insert into deliverables (
      tenant_id, stream_id, name, state, due_at, owner_user_id,
      deliverable_type_id, quantity, channel, format, phase_id, priority,
      workstream_id, content_idea, notes, language, is_given_to_client
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
      -- SJ-v3-04 (20260922160000): high | medium | low, refused by chk_deliverables_priority.
      nullif(v_deliv ->> 'priority', ''),
      -- I56.3: the group. Set HERE and not afterwards — the department stamp and the code's
      -- letters are both read off it by BEFORE INSERT triggers.
      v_ws_id,
      -- I56.8 / I56.7: the piece's own words, and the one language it ships in.
      nullif(v_deliv ->> 'contentIdea', ''),
      nullif(v_deliv ->> 'notes', ''),
      nullif(v_deliv ->> 'language', ''),
      -- I56.11 Q4: a MARKER that the date has been told to the client. Absent means no.
      coalesce((v_deliv ->> 'isGivenToClient')::boolean, false)
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

comment on function app.write_campaign_content(uuid, jsonb, timestamptz, jsonb, jsonb, jsonb) is
  'ADR-0067: the ONE writer of a campaign''s content, shared by the one-shot path and the draft '
  'path so they cannot disagree. I56.3/I56.8 add `p_workstreams` — [{ key, name, departmentId, '
  'ownerUserId }] with a CLIENT-side key — and, per deliverable, workstreamKey / contentIdea / '
  'notes / language; per phase, endsOnEvent. I56.11 adds isGivenToClient per deliverable. Every one '
  'is optional.';

commit;
