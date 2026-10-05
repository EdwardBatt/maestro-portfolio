-- The campaign wizard writes what section C added: the groups, a piece's own words, and the event
-- a phase ends on (I56.3, I56.8 — ADR-0096, ADR-0099).
--
-- Section C put six new things on a campaign's work and the wizard collects every one of them.
-- None of them reached the database, because the one content writer — `app.write_campaign_content`
-- (ADR-0067) — still writes the columns it wrote in August:
--
--   deliverables.content_idea   `20260923230000`  the line the creative reads first (CB-v3-P4)
--   deliverables.notes          `20260924090000`  the account manager's own aside
--   deliverables.language       `20260923230000`  the ONE language this piece ships in (I56.7)
--   deliverables.priority       `20260922160000`  already written; named here for completeness
--   deliverables.workstream_id  `20260923140000`  the group (ADR-0099 d.1)
--   campaign_phases.ends_on_event `20260924091000`  the event a phase plans backwards from (P1)
--
-- So a person laid out five workstreams in the wizard, pressed submit, and got a campaign with no
-- groups in it. The doors added by `20260923210000` (`save_workstream` and the rest) are the work
-- SCREEN's doors: they change a campaign that already exists. Creating one was still a path of its
-- own, and this puts the two back together.
--
-- THE GROUPS ARE CREATED IN THE SAME STATEMENT AS THE WORK. That is the whole shape of this
-- migration and it is worth saying why, because the obvious alternative — create the campaign,
-- then call `save_workstream` five times, then move each deliverable in — is what the client would
-- otherwise have to do. It is six round trips that can each half-fail, it leaves a campaign with
-- groups and no work if the tab closes, and it re-numbers nothing correctly: a piece's code takes
-- its letters from the workstream it is inserted INTO (`app.tg_deliverable_stamp_code`,
-- `20260924092000`), so a piece grouped after the fact would already be carrying `WS-001`.
--
--   The payload gains `workstreams: [{ key, name, departmentId, ownerUserId }]`, where `key` is the
--   wizard's OWN draft id — a string it made up, not a uuid, because the rows do not exist yet.
--   Each deliverable names its group by that same `workstreamKey`. The keys are resolved to real
--   ids here and never stored.
--
-- THE DEPARTMENT IS NOT PASSED, DELIBERATELY. `app.tg_deliverable_stamp_department` already takes
-- it from the workstream on insert (ADR-0099 d.3, as rewritten by `20260923190000` and made to
-- fire by `20260923220000`). Setting `workstream_id` in the INSERT is therefore the whole of it;
-- a second `department_id = …` here would be a second copy of the rule, which is how the two drift.
--
-- ADDITIVE ONLY. Every new field is optional and absent means null, so a caller that knows none of
-- them — pgTAP `102`'s positional seven-argument call, `supabase/seed.sql`, the single-job path —
-- writes exactly what it wrote yesterday. A deliverable with no `workstreamKey` stays ungrouped,
-- which is a normal and permanent state (ADR-0099 d.1), not a step on the way to being grouped.

begin;

-- ============================================================================
-- 1) a phase carries the event it ends on (I56.10)
-- ============================================================================
-- The 6-argument form is dropped rather than left beside this one: a defaulted argument added to a
-- live signature makes every existing 6-argument call ambiguous ("function is not unique") instead
-- of resolving to the new one.
drop function if exists app.insert_campaign_phase(uuid, uuid, integer, text, date, date);

create or replace function app.insert_campaign_phase(
  p_tenant uuid, p_campaign uuid, p_number integer, p_name text,
  p_starts_on date, p_ends_on date, p_ends_on_event text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_id uuid;
begin
  if p_tenant is distinct from app.current_tenant_id() then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'phase % needs a name', p_number using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'phase % needs a start and an end', p_number using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'phase % cannot end before it starts', p_number using errcode = '22023';
  end if;
  insert into campaign_phases (tenant_id, campaign_id, number, name, starts_on, ends_on, ends_on_event)
  values (p_tenant, p_campaign, p_number, trim(p_name), p_starts_on, p_ends_on,
          nullif(btrim(coalesce(p_ends_on_event, '')), ''))
  returning id into v_id;
  return v_id;
end $$;

comment on function app.insert_campaign_phase(uuid, uuid, integer, text, date, date, text) is
  'ADR-0096 d.2 with I56.10: the one insert into campaign_phases the wizard makes. `ends_on_event` '
  'is the real-world thing the stretch is aimed at — "Draw Night 2" — and is null where the phase '
  'simply ends on its date.';

revoke execute on function app.insert_campaign_phase(uuid, uuid, integer, text, date, date, text) from public;
grant  execute on function app.insert_campaign_phase(uuid, uuid, integer, text, date, date, text) to authenticated;

-- ============================================================================
-- 2) one workstream, made as part of creating the campaign (ADR-0099 d.1/d.3/d.5/d.7)
-- ============================================================================
-- The same four rules `save_workstream` holds, said in the same words, because a person meeting
-- them in the wizard and on the work screen is meeting one rule and should hear one sentence.
-- Security INVOKER: `workstreams_tenant_write` asks for projects:manage, which is exactly what
-- `campaigns_tenant_write` asked for one statement earlier — whoever is creating this campaign
-- has already passed this test.
create or replace function app.insert_campaign_workstream(
  p_campaign uuid, p_name text, p_department uuid, p_owner uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_clash  text;
  v_id     uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A workstream needs a name.' using errcode = '22023';
  end if;

  -- d.3, said as a sentence rather than left to the NOT NULL: "null value in column department_id"
  -- is not something to show a person who left a picker alone.
  if p_department is null then
    raise exception 'A workstream needs a department: it is what decides who can be given the work.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from departments d where d.id = p_department and d.tenant_id = v_tenant) then
    raise exception 'that department is not in your organization' using errcode = '22023';
  end if;

  -- d.7: unique within the campaign, case-insensitively. Two rows of the SAME payload clashing is
  -- the ordinary way this happens in the wizard — a person typed "Always-on" and then "always-on"
  -- into two group cards — and it has to arrive as the sentence, not as
  -- "duplicate key value violates unique constraint uq_workstreams_campaign_name". The message
  -- names the group already there, because that is the one the person has to go and find.
  select w.name into v_clash
    from workstreams w
   where w.campaign_id = p_campaign
     and lower(trim(w.name)) = lower(trim(p_name))
   limit 1;
  if v_clash is not null then
    raise exception 'This campaign already has a workstream called "%".', v_clash
      using errcode = '23505', hint = 'workstream_name_taken';
  end if;

  insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id)
  values (v_tenant, p_campaign, trim(p_name), p_department, p_owner)
  returning id into v_id;
  return v_id;
end $$;

comment on function app.insert_campaign_workstream(uuid, text, uuid, uuid) is
  'I56.3 (ADR-0099 d.1/d.3/d.5/d.7): the wizard''s workstream, made in the same call that creates '
  'the campaign. Holds the same four rules as public.save_workstream and refuses in the same '
  'words — a clash between two cards of one payload is the ordinary case here, and a person must '
  'not meet it as a unique-index violation.';

revoke execute on function app.insert_campaign_workstream(uuid, text, uuid, uuid) from public, anon;
grant  execute on function app.insert_campaign_workstream(uuid, text, uuid, uuid) to authenticated;

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
      workstream_id, content_idea, notes, language
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
      nullif(v_deliv ->> 'language', '')
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
  'notes / language; per phase, endsOnEvent. Every one is optional.';

-- ============================================================================
-- 4) the two doors, reproduced with the new argument
-- ============================================================================
drop function if exists public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb);

create or replace function public.complete_campaign_draft(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb,
  p_phases       jsonb default null,
  p_workstreams  jsonb default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
begin
  select c.status into v_status from campaigns c
   where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'draft' then
    raise exception 'campaign_not_draft' using errcode = 'check_violation';
  end if;

  perform app.write_campaign_content(p_campaign, p_brief, p_go_live, p_deliverables, p_phases, p_workstreams);

  update campaigns set status = 'pending_approval'
   where id = p_campaign and tenant_id = v_tenant;

  return p_campaign;
end $$;

comment on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb, jsonb) is
  'ADR-0067 d.4, with ADR-0096 d.8 and I56.3: the wizard''s submit. Writes the brief, the phases, '
  'the workstreams, the stream and the deliverables through app.write_campaign_content, then '
  'draft -> pending_approval.';

revoke execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb, jsonb) from public, anon;
grant  execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb, jsonb) to authenticated;

drop function if exists public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb);

create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb,
  p_account_manager uuid default null,
  p_kind text default 'campaign',
  p_phases jsonb default null,
  p_workstreams jsonb default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_am       uuid;
begin
  if p_kind is null or p_kind not in ('single_job', 'campaign') then
    raise exception 'kind must be single_job or campaign' using errcode = '22023';
  end if;
  if p_kind = 'single_job' and p_phases is not null and jsonb_typeof(p_phases) = 'array' and jsonb_array_length(p_phases) > 0 then
    raise exception 'a single job does not run in phases' using errcode = '22023';
  end if;

  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, account_manager_id, kind)
  values (v_tenant, p_client, p_brand, p_name, v_am, p_kind)
  returning id into v_campaign;

  perform app.write_campaign_content(v_campaign, p_brief, p_go_live, p_deliverables, p_phases, p_workstreams);

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb, jsonb) is
  'ADR-0020 as revised by ADR-0050/0051, ADR-0067, ADR-0086 d.8, ADR-0096 d.8 and ADR-0099 (I56.3, '
  'I56.8): the ONE-SHOT path. p_phases is the wizard''s Phases step and a single job may not pass '
  'one; p_workstreams is its groups, keyed by the wizard''s own draft ids.';

revoke execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb, jsonb) from public, anon;
grant  execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb, jsonb) to authenticated;

commit;
