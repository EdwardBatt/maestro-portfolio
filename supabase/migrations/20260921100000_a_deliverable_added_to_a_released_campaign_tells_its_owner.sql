-- I53.18 — A deliverable added to a released campaign tells its new owner (Edward, 21 Sep).
--
-- The inspection walk of 21 Sep added work to a released campaign twice — once by hand (*Add
-- deliverable*), once from the model's proposals (*Propose more*) — and neither new owner had a
-- mail, an inbox row or a line on My Work. Both routes are `public.add_campaign_deliverable`,
-- which wrote no notification; only `attach_job_to_campaign` (Action 15, 17 Sep) told anybody.
--
-- Edward's decision, 21 Sep, in his words: *"When a deliverable is added, the assignee must be
-- notified. When the system proposed deliverables.. this is a proposal only.. it is only accepted
-- as deliverable once it is assigned. Email only for the owner of the added deliverables…
-- existing owners should only be notified of changes to their existing deliverables."*
--
-- So: ONE row, to the NEW deliverable's owner, of the type Action 15 already words —
-- `deliverable_added` with `for_owner = true`: "<AM> added <deliverable> to <campaign>. You need to
-- review the brief and tasks and then approve so each task can be assigned." Nobody else — not the
-- other owners on the campaign (Action 15's one-line notice is NOT sent here), never the actor.
-- Only on a RELEASED campaign: a deliverable added to a draft or a pending campaign is told of at
-- approval, by Action 1, like every other.
--
-- A proposal the account manager does not accept never reaches this function — the dialog adds
-- only the rows given an owner and a date — which is what "a proposal only" means in code.
--
-- Reproduced from 20260920120000 (its latest definition); one addition, at the end.

begin;

create or replace function public.add_campaign_deliverable(
  p_campaign uuid, p_name text, p_owner uuid, p_type uuid default null, p_quantity integer default 1,
  p_due_at timestamptz default null, p_due_override jsonb default null, p_phase uuid default null)
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

  select s.id into v_stream from streams s where s.campaign_id = p_campaign order by s.created_at limit 1;
  if v_stream is null then
    insert into streams (tenant_id, campaign_id, name) values (v_tenant, p_campaign, v.name)
    returning id into v_stream;
  end if;

  insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, deliverable_type_id, quantity, phase_id)
  values (v_tenant, v_stream, trim(p_name), 'draft', p_due_at, p_owner, p_type, greatest(coalesce(p_quantity, 1), 1),
          case when v.has_phases then p_phase end)
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

comment on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid) is
  'I52.20 with ADR-0096 d.8 and ADR-0093 addendum d.7: add a deliverable to an existing campaign '
  'or job, under the approval authority. A due date is required; p_phase is required when the '
  'campaign runs in phases. I53.18: on a released campaign the new owner is told (deliverable_added, '
  'for_owner) and nobody else.';

commit;
