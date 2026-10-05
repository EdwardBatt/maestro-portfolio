-- I53.6 — ADR-0093 addendum d.7/d.8 (Edward, 20 Sep): a deliverable is never created without a
-- due date. "Due Date is mandatory."
--
-- The wizards already refuse Next without one; the doors that did not were
-- add_campaign_deliverable (p_due_at default null) and a direct insert. One guard covers every
-- door (ADR-0037): a deliverable under a CAMPAIGN (through its stream, or a job that belongs to a
-- campaign) must carry due_at on insert. Ad-hoc work — a job with no campaign — takes its task's
-- day and is not covered here; the ad-hoc RPC already requires the date.
--
-- EXISTING ROWS ARE LEFT AS THEY ARE (d.8): no backfill, no NOT NULL. Production carries dateless
-- deliverables and a constraint would refuse the migration or invent a date. The pages mark such a
-- row "no due date — set one". Only INSERT is guarded; an update that clears the date is refused
-- too, so a date cannot be taken away once given.
--
-- Skipped when nobody is signed in (migrations, seeders, pgTAP fixtures) or under app.system_op,
-- as every guard is.

begin;

create or replace function app.tg_deliverable_due_date_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_campaign uuid;
begin
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if new.due_at is not null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.due_at is null then
    -- An old dateless row being edited for something else: not this guard's business.
    return new;
  end if;
  select coalesce(s.campaign_id, j.campaign_id) into v_campaign
    from (select 1) x
    left join public.streams s on s.id = new.stream_id
    left join public.jobs    j on j.id = new.job_id;
  if v_campaign is null then
    return new;
  end if;
  raise exception 'a deliverable needs a due date' using errcode = '22023';
end $$;

comment on function app.tg_deliverable_due_date_guard() is
  'ADR-0093 addendum d.7: a deliverable under a campaign is never created without a due date, and '
  'a date once given cannot be cleared. Existing dateless rows are left alone (d.8). Held in '
  'Postgres so the wizard, add_campaign_deliverable and a PATCH are governed identically.';

drop trigger if exists deliverable_due_date_guard on deliverables;
create trigger deliverable_due_date_guard
  before insert or update of due_at on deliverables
  for each row execute function app.tg_deliverable_due_date_guard();

-- add_campaign_deliverable says it in words before the insert would.
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
  return v_id;
end $$;

comment on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid) is
  'I52.20 with ADR-0096 d.8 and ADR-0093 addendum d.7: add a deliverable to an existing campaign '
  'or job, under the approval authority. A due date is required; p_phase is required when the '
  'campaign runs in phases.';

commit;
