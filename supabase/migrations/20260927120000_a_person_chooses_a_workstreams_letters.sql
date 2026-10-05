-- I59.54 (Edward, 27 Sep: option A — "suggest, and let them change it").
--
-- A workstream's letters (DA in DA-001) were worked out by a rule from its name (I56.9) and fixed when
-- it is made (I59.53). The frames show letters no rule gives — IA, TV, INF — so the person making a
-- workstream now sees the rule's suggestion and may type their own. What they type is what every piece
-- in it is coded with, and, as before, it never changes after the workstream is made.
--
-- 1) The letters trigger accepts typed letters on insert and checks them: two to four Latin letters,
--    stored in capitals. Left empty, the rule gives them, exactly as yesterday.
-- 2) Both doors that make a workstream take the letters:
--      - `app.insert_campaign_workstream` (the wizard, through `app.write_campaign_content`, which
--        reads `codeLetters` per workstream in the payload), and
--      - `public.save_workstream` (the campaign page) — used only when MAKING one; a rename or re-own
--        passes none and could not move them anyway.
--    Each gains one trailing optional argument, so every existing positional call is unchanged.
--
-- Two workstreams in one campaign may share letters, as the rule already allows (Influencers and
-- Influence both give INF): the pieces share one count, so their codes stay unique.

begin;

-- ============================================================================
-- 1) the letters: typed, or the rule's — then fixed
-- ============================================================================
create or replace function app.tg_workstream_code_letters()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  v_typed text;
begin
  if tg_op = 'INSERT' then
    v_typed := upper(nullif(btrim(new.code_letters), ''));
    if v_typed is null then
      new.code_letters := app.workstream_code_letters(new.name);
    elsif v_typed !~ '^[A-Z]{2,4}$' then
      raise exception 'A workstream''s letters are two to four Latin letters, like DA or INF.'
        using errcode = '22023', hint = 'workstream_letters_invalid';
    else
      new.code_letters := v_typed;
    end if;
  else
    new.code_letters := old.code_letters;   -- fixed for life: a rename does not move them
  end if;
  return new;
end $$;

comment on function app.tg_workstream_code_letters() is
  'I59.53/I59.54: a workstream''s code letters are the ones the person typed when making it (two to '
  'four Latin letters, stored in capitals), or the rule''s from its name when they typed none — and '
  'never change after.';

-- ============================================================================
-- 2a) the wizard's door
-- ============================================================================
drop function if exists app.insert_campaign_workstream(uuid, text, uuid, uuid);

create or replace function app.insert_campaign_workstream(
  p_campaign uuid, p_name text, p_department uuid, p_owner uuid default null,
  p_code_letters text default null)
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

  -- d.7: unique within the campaign, case-insensitively, and the message names the group already there.
  select w.name into v_clash
    from workstreams w
   where w.campaign_id = p_campaign
     and lower(trim(w.name)) = lower(trim(p_name))
   limit 1;
  if v_clash is not null then
    raise exception 'This campaign already has a workstream called "%".', v_clash
      using errcode = '23505', hint = 'workstream_name_taken';
  end if;

  -- I59.54: the letters go in with the row; the trigger checks them, or gives the rule's when empty.
  insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id, code_letters)
  values (v_tenant, p_campaign, trim(p_name), p_department, p_owner, p_code_letters)
  returning id into v_id;
  return v_id;
end $$;

comment on function app.insert_campaign_workstream(uuid, text, uuid, uuid, text) is
  'I56.3 (ADR-0099 d.1/d.3/d.5/d.7): the wizard''s workstream, made in the same call that creates '
  'the campaign. Holds the same four rules as public.save_workstream and refuses in the same '
  'words. I59.54: optional typed code letters, checked by the workstreams trigger.';

revoke execute on function app.insert_campaign_workstream(uuid, text, uuid, uuid, text) from public, anon;
grant  execute on function app.insert_campaign_workstream(uuid, text, uuid, uuid, text) to authenticated;

-- ============================================================================
-- 2b) the one content writer (ADR-0067), reproduced whole from 20260924140000
-- ============================================================================
-- The only change is the fifth argument to app.insert_campaign_workstream: `codeLetters`.
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
        nullif(v_ws ->> 'ownerUserId', '')::uuid,
        -- I59.54: the letters the person typed; absent means the rule's.
        nullif(v_ws ->> 'codeLetters', ''));
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
  'ownerUserId, codeLetters }] with a CLIENT-side key — and, per deliverable, workstreamKey / '
  'contentIdea / notes / language; per phase, endsOnEvent. I56.11 adds isGivenToClient per '
  'deliverable; I59.54 adds codeLetters per workstream. Every one is optional.';

-- ============================================================================
-- 2c) the campaign page's door, reproduced whole from 20260924160000
-- ============================================================================
drop function if exists public.save_workstream(uuid, text, uuid, uuid, uuid);

create or replace function public.save_workstream(
  p_campaign     uuid,
  p_name         text,
  p_department   uuid,
  p_owner        uuid default null,
  p_workstream   uuid default null,
  p_code_letters text default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
  v_clash  text;
begin
  if not exists (select 1 from campaigns c where c.id = p_campaign and c.tenant_id = v_tenant) then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  if not app.is_campaign_authority(p_campaign) then
    raise exception 'You cannot change this campaign''s workstreams: it is outside your reach. Ask its account manager, an Account Director or Traffic.'
      using errcode = '42501', hint = 'save_workstream';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A workstream needs a name.' using errcode = '22023';
  end if;

  if p_department is null then
    raise exception 'A workstream needs a department: it labels the group and starts its owner list.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from departments d where d.id = p_department and d.tenant_id = v_tenant) then
    raise exception 'that department is not in your organization' using errcode = '22023';
  end if;

  -- d.7, and the message names the EXISTING group: "always-on" colliding with "Always-on" has to
  -- point at the one already there, or the person cannot find what is in their way.
  select w.name into v_clash
    from workstreams w
   where w.campaign_id = p_campaign
     and lower(trim(w.name)) = lower(trim(p_name))
     and (p_workstream is null or w.id <> p_workstream)
   limit 1;
  if v_clash is not null then
    raise exception 'This campaign already has a workstream called "%".', v_clash
      using errcode = '23505', hint = 'workstream_name_taken';
  end if;

  if p_workstream is null then
    -- I59.54: typed letters, or none for the rule's; the trigger checks them.
    insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id, code_letters)
    values (v_tenant, p_campaign, trim(p_name), p_department, p_owner, p_code_letters)
    returning id into v_id;
    return v_id;
  end if;

  -- A rename or re-own. The letters were fixed when the group was made; p_code_letters is ignored.
  update workstreams
     set name = trim(p_name),
         department_id = p_department,
         owner_user_id = p_owner
   where id = p_workstream and tenant_id = v_tenant and campaign_id = p_campaign;
  if not found then
    raise exception 'workstream % not found on this campaign', p_workstream using errcode = 'P0002';
  end if;

  return p_workstream;
end $$;

comment on function public.save_workstream(uuid, text, uuid, uuid, uuid, text) is
  'ADR-0099 d.1/d.5/d.7, ADR-0102 d.2: make a workstream, or rename and re-own one. A name is unique '
  'per campaign, case-insensitively; a department is required and labels the group. Changing it moves '
  'none of the group''s deliverables — a deliverable''s department is its owner''s (ADR-0102 d.1). '
  'I59.54: p_code_letters, when making one — typed letters, or null for the rule''s; ignored on a rename.';

grant  execute on function public.save_workstream(uuid, text, uuid, uuid, uuid, text) to authenticated;

commit;
