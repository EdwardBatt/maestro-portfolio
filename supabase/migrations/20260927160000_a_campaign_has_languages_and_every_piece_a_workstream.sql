-- ADR-0116 and ADR-0117 (Edward, 27 Sep; accepted the same day) — I60.
--
-- 1) `campaigns.languages` — the languages a campaign or single job is made in (codes from the tenant's
--    `language` list, in the order chosen).
-- 2) `public.add_language(label)` — a person with `projects:manage` adds a language the list lacks
--    (security definer, authorised by ADR-0117 d.3); returns its code.
-- 3) `app.write_campaign_content` — reproduced whole from 20260927120000: writes `languages` from the
--    brief's `languages`, and refuses a CAMPAIGN piece with no workstream (ADR-0116 d.3).
-- 4) `app.materialise_deliverable_workflow` — reproduced whole from 20260927140000: adds ONE translation task,
--    "Translation — ‹deliverable› (English, Arabic, Kurdish)", straight after Write Copy (else last), once.
-- 5) `public.add_campaign_deliverable` — reproduced from 20260921100000: a campaign's piece added after
--    approval names its workstream (ADR-0116 d.3); a single job's never does.

begin;

-- ============================================================================
-- 1) the languages
-- ============================================================================
alter table campaigns add column if not exists languages text[] not null default '{}';

comment on column campaigns.languages is
  'ADR-0117 d.1: the languages the campaign or single job is made in — `language` codes from '
  'deliverable_attribute_values, in the order chosen. Every deliverable gets one translation task when any is set.';

-- English / Arabic / Kurdish are already every tenant's languages: seeded for new tenants by
-- `app.seed_tenant_languages` (20260926180000, I59.37) and for existing ones by 20260923230000.

-- ============================================================================
-- 2) a language the list lacks, added by the person who needs it
-- ============================================================================
create or replace function public.add_language(p_label text)
returns text
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_label  text := btrim(coalesce(p_label, ''));
  v_code   text;
  v_base   text;
  v_n      integer := 1;
begin
  if v_tenant is null or not app.has_permission('projects', 'manage') then
    raise exception 'You cannot add a language: it needs the right to manage campaigns.' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'A language needs a name.' using errcode = '22023';
  end if;

  select code into v_code from deliverable_attribute_values
   where tenant_id = v_tenant and attribute = 'language' and lower(label_en) = lower(v_label)
   limit 1;
  if v_code is not null then
    update deliverable_attribute_values set is_active = true
     where tenant_id = v_tenant and attribute = 'language' and code = v_code and not is_active;
    return v_code;
  end if;

  v_base := nullif(regexp_replace(lower(v_label), '[^a-z]+', '', 'g'), '');
  v_base := coalesce(left(v_base, 12), 'lang');
  v_code := v_base;
  while exists (select 1 from deliverable_attribute_values
                 where tenant_id = v_tenant and attribute = 'language' and code = v_code) loop
    v_n := v_n + 1;
    v_code := v_base || '-' || v_n;
  end loop;

  insert into deliverable_attribute_values (tenant_id, attribute, code, label_en, sort_order, created_by)
  values (v_tenant, 'language', v_code, v_label,
          coalesce((select max(sort_order) from deliverable_attribute_values
                     where tenant_id = v_tenant and attribute = 'language'), 0) + 1,
          auth.uid());
  return v_code;
end $$;

comment on function public.add_language(text) is
  'ADR-0117 d.3: add a language the tenant list lacks (or re-activate one of that name); needs '
  'projects:manage; returns the code. Security definer because the list is written only with '
  'organization:manage otherwise.';

revoke execute on function public.add_language(text) from public, anon;
grant  execute on function public.add_language(text) to authenticated;

-- ============================================================================
-- 3) the one content writer (ADR-0067), reproduced whole from 20260927120000
-- ============================================================================
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
         has_phases  = v_on,
         -- ADR-0117 d.1: the languages chosen, in their order. Absent or not a list leaves none.
         languages   = coalesce((
           select array_agg(x.code order by x.n)
             from jsonb_array_elements_text(
                    case when jsonb_typeof(p_brief -> 'languages') = 'array' then p_brief -> 'languages' else '[]'::jsonb end
                  ) with ordinality as x(code, n)
            where btrim(x.code) <> ''), '{}')
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
    -- ADR-0116 d.3: every piece of a CAMPAIGN is in a workstream. A single job's piece never is.
    if v_kind = 'campaign' and v_ws_id is null then
      raise exception 'Every piece of a campaign goes in a workstream: "%" is in none.',
        coalesce(v_deliv ->> 'name', '?') using errcode = '22023', hint = 'piece_needs_workstream';
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
-- 4) the task list, created — reproduced whole from 20260927140000
-- ============================================================================
create or replace function app.materialise_deliverable_workflow(
  p_deliverable uuid,
  p_template uuid default null
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_name     text;
  v_qty      integer;
  v_created  integer;
  v_langs    text;
  v_after    integer;
begin
  select d.tenant_id, d.department_id, app.task_segment(d.name), greatest(coalesce(d.quantity, 1), 1),
         coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_name, v_qty, v_template
    from deliverables d
    left join deliverable_types dt on dt.id = d.deliverable_type_id
   where d.id = p_deliverable;

  if v_tenant is null or v_template is null then
    return 0;
  end if;

  if not exists (select 1 from workflow_templates wt
                  where wt.id = v_template and wt.tenant_id = v_tenant) then
    raise exception 'that workflow template is not in your organization' using errcode = '22023';
  end if;

  insert into sub_tasks (
    tenant_id, deliverable_id, title, description, department_id,
    status, sort_order, workflow_step_id, unit_index, review_mode, created_by
  )
  select
    v_tenant,
    p_deliverable,
    -- ADR-0071 d.10, composed here at creation and then copied. I57.48: `v_name` is the deliverable's
    -- name without its " ×N" count.
    ws.title_en
      || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end
      || case when ws.repeats_per_unit and v_qty > 1 then ' ' || u.n::text else '' end,
    ws.description_en,
    v_dept,
    'todo',
    ws.sort_order,
    ws.id,
    case when ws.repeats_per_unit then u.n else null end,
    ws.review_mode,
    auth.uid()
  from workflow_steps ws
  cross join lateral generate_series(1, case when ws.repeats_per_unit then v_qty else 1 end) as u(n)
  where ws.tenant_id = v_tenant
    and ws.template_id = v_template
    and ws.is_active
    and not exists (
      select 1 from sub_tasks st
       where st.deliverable_id = p_deliverable
         and st.workflow_step_id = ws.id
         and coalesce(st.unit_index, 0)
             = coalesce(case when ws.repeats_per_unit then u.n else null end, 0)
    )
  order by ws.sort_order, u.n;

  get diagnostics v_created = row_count;

  -- ADR-0117 d.4-d.6: ONE translation task naming every language the campaign or job is made in, straight
  -- after Write Copy (else last), added once. The owner removes it where it is not wanted.
  select string_agg(coalesce(av.label_en, l.code), ', ' order by l.n)
    into v_langs
    from deliverables d
    join streams s on s.id = d.stream_id
    join campaigns c on c.id = s.campaign_id
    cross join lateral unnest(c.languages) with ordinality as l(code, n)
    left join deliverable_attribute_values av
           on av.tenant_id = c.tenant_id and av.attribute = 'language' and av.code = l.code
   where d.id = p_deliverable;

  if v_langs is not null and not exists (
    select 1 from sub_tasks st
     where st.deliverable_id = p_deliverable and st.title like 'Translation — %'
  ) then
    select max(st.sort_order) into v_after
      from sub_tasks st
      join workflow_steps ws on ws.id = st.workflow_step_id
     where st.deliverable_id = p_deliverable
       and ws.title_en ilike 'Write Copy%';
    if v_after is null then
      select coalesce(max(st.sort_order), 0) into v_after from sub_tasks st where st.deliverable_id = p_deliverable;
    else
      -- Make room: every later step moves down one, so the list reads ... Write Copy, Translation, ...
      update sub_tasks set sort_order = sort_order + 1
       where deliverable_id = p_deliverable and sort_order > v_after;
    end if;
    insert into sub_tasks (tenant_id, deliverable_id, title, department_id, status, sort_order, review_mode, created_by)
    values (v_tenant, p_deliverable,
            'Translation — ' || coalesce(nullif(v_name, ''), 'deliverable') || ' (' || v_langs || ')',
            v_dept, 'todo', v_after + 1, 'digital', auth.uid());
    v_created := v_created + 1;
  end if;

  return v_created;
end $$;

comment on function app.materialise_deliverable_workflow(uuid, uuid) is
  'ADR-0052 d.5/d.6, extended by ADR-0059 d.3 and ADR-0071 d.9/d.10: create the unassigned task '
  'list for a deliverable — one task per active step, and `quantity` tasks for a step marked '
  'repeats_per_unit, each carrying its unit number and the step''s review mode. Titles are composed '
  'from step, deliverable (without its " ×N" count, I57.48) and unit at creation and copied '
  'thereafter; ADR-0117 adds ONE translation task naming the campaign''s languages, after Write Copy. '
  'Returns how many were created. Idempotent on (deliverable, step, unit) and on the translation task.';

-- ============================================================================
-- 5) a piece added on the campaign page names its workstream — reproduced from 20260921100000
-- ============================================================================
-- ADR-0116 d.3: after approval too, a campaign's new piece goes into a workstream; it is set on the
-- INSERT, so the code takes that workstream's letters. A single job's piece takes none.
drop function if exists public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid);

create or replace function public.add_campaign_deliverable(
  p_campaign uuid, p_name text, p_owner uuid, p_type uuid default null, p_quantity integer default 1,
  p_due_at timestamptz default null, p_due_override jsonb default null, p_phase uuid default null,
  p_workstream uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaigns;
  v_stream uuid;
  v_id     uuid;
  v_phase_end date;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if v.status = 'closed' then
    raise exception 'this campaign is closed — reopen it before adding to it' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(p_campaign) then
    raise exception
      'adding a deliverable to this campaign is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if p_owner is null or not exists (select 1 from user_profiles up where up.id = p_owner and up.tenant_id = v_tenant) then
    raise exception 'a deliverable needs an owner' using errcode = '22023';
  end if;
  if p_type is not null and not exists (
       select 1 from deliverable_types dt where dt.id = p_type and dt.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;
  if p_due_at is null then
    raise exception 'a deliverable needs a due date' using errcode = '22023';
  end if;
  if v.has_phases and p_phase is null then
    raise exception 'this campaign runs in phases — choose the phase' using errcode = '22023';
  end if;
  -- ADR-0116 d.3: a campaign's piece names its workstream, one of this campaign's.
  if v.kind = 'campaign' then
    if p_workstream is null then
      raise exception 'Every piece of a campaign goes in a workstream: choose one for "%".', trim(p_name)
        using errcode = '22023', hint = 'piece_needs_workstream';
    end if;
    if not exists (select 1 from workstreams w where w.id = p_workstream and w.campaign_id = p_campaign) then
      raise exception 'that workstream is not on this campaign' using errcode = '22023';
    end if;
  end if;

  select s.id into v_stream from streams s where s.campaign_id = p_campaign order by s.created_at limit 1;
  if v_stream is null then
    insert into streams (tenant_id, campaign_id, name) values (v_tenant, p_campaign, v.name)
    returning id into v_stream;
  end if;

  insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, deliverable_type_id, quantity, phase_id, workstream_id)
  values (v_tenant, v_stream, trim(p_name), 'draft', p_due_at, p_owner, p_type, greatest(coalesce(p_quantity, 1), 1),
          case when v.has_phases then p_phase end,
          case when v.kind = 'campaign' then p_workstream end)
  returning id into v_id;

  if p_due_override is not null and jsonb_typeof(p_due_override) = 'object' then
    select p.ends_on into v_phase_end from campaign_phases p where p.id = p_phase;
    perform app.record_due_date_override(
      v_id,
      (p_due_at at time zone 'Asia/Baghdad')::date,
      p_due_override ->> 'severity',
      (v.go_live_at at time zone 'UTC')::date,
      coalesce((p_due_override ->> 'workingDaysLeft')::int, 0),
      coalesce((p_due_override ->> 'requiredDays')::int, 0),
      nullif(p_due_override ->> 'outstandingHours', '')::numeric,
      nullif(p_due_override ->> 'capacityHours', '')::numeric,
      coalesce(p_due_override ->> 'boundary', 'go_live'),
      case when coalesce(p_due_override ->> 'boundary', 'go_live') = 'phase_end' then v_phase_end end);
  end if;

  -- I53.18 (Edward, 21 Sep): on a RELEASED campaign, the new deliverable's owner is told — and only
  -- them. The words are Action 15's for_owner sentence; the button opens the deliverable.
  if v.status = 'approved' and p_owner is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, p_owner, 'deliverable_added', trim(p_name), 'deliverable', v_id, auth.uid(),
            jsonb_build_object('for_owner', true, 'due_at', p_due_at));
  end if;
  return v_id;
end $$;

comment on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) is
  'I52.20 with ADR-0096 d.8 and ADR-0093 addendum d.7: add a deliverable to an existing campaign '
  'or job, under the approval authority. A due date is required; p_phase is required when the '
  'campaign runs in phases. I53.18: on a released campaign the new owner is told (deliverable_added, '
  'for_owner) and nobody else. ADR-0116 d.3: a campaign''s piece names p_workstream (one of its own).';

revoke execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) from public, anon;
grant  execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) to authenticated;

commit;
