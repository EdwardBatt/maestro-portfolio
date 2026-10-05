-- I53.5 — ADR-0096: a campaign is optionally broken into phases, and every deliverable belongs to one.
--
-- The LUMA S2 content master sheet (docs/reference/) is the team's own attempt at this shape: every
-- piece carries a WEEK (its phase) and its own DUE DATE, and the dashboard the team reads is a
-- phase x workstream grid. Nothing in Maestro knew the word.
--
-- ADDITIVE ONLY (ADR-0096 d.13). A new table, a nullable column, a boolean defaulting to false,
-- triggers that refuse and never rewrite. No backfill, nothing moved, nothing dropped. Every
-- campaign on production stays exactly as it is, with phases off.
--
--   * campaigns.has_phases                 — the toggle (d.1); a single job is always false.
--   * campaign_phases                      — number (contiguous from 1), name, starts_on, ends_on;
--                                            overlap allowed (d.2). Read tenant-wide; written by the
--                                            RPCs below only.
--   * deliverables.phase_id                — nullable; app.tg_deliverable_phase_guard holds the
--                                            invariant BOTH ways (d.3): phases on => a phase of
--                                            that campaign; phases off => none.
--   * set_campaign_phases / save_campaign_phase / delete_campaign_phase / move_deliverable_to_phase
--                                          — the four doors (d.4–d.6), under the campaign's approval
--                                            authority: the account manager, or projects:manage
--                                            with reach over them — the add_campaign_deliverable
--                                            test. SECURITY DEFINER where the caller's role holds
--                                            no row write on the table (deliverables of a
--                                            department they do not reach; campaign_phases, which
--                                            has no write policy), with the authority tested
--                                            inside, exactly as add_campaign_deliverable does.
--   * record_due_date_override             — gains the boundary (go_live | phase_end) and the
--                                            boundary day, so a date past the phase's end is
--                                            recorded the way one past go-live is (d.7).
--   * write_campaign_content / complete_campaign_draft / create_campaign_from_brief
--                                          — gain p_phases: the wizard's Phases step (d.8). A
--                                            deliverable row carries phaseNumber.

begin;

-- ============================================================================
-- 1) the toggle
-- ============================================================================
alter table campaigns
  add column if not exists has_phases boolean not null default false;

alter table campaigns
  drop constraint if exists chk_campaigns_single_job_has_no_phases;
alter table campaigns
  add constraint chk_campaigns_single_job_has_no_phases
  check (kind <> 'single_job' or has_phases = false);

comment on column campaigns.has_phases is
  'ADR-0096 d.1: phases are optional, per campaign. A single job is always false (the check); '
  'promotion leaves it false. Flipped only by set_campaign_phases.';

-- ============================================================================
-- 2) the phases
-- ============================================================================
create table if not exists campaign_phases (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  number      integer not null check (number >= 1),
  name        text not null check (length(trim(name)) > 0),
  starts_on   date not null,
  ends_on     date not null check (ends_on >= starts_on),
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (campaign_id, number)
);

create index if not exists idx_campaign_phases_tenant_id on campaign_phases (tenant_id);
create index if not exists idx_campaign_phases_campaign  on campaign_phases (campaign_id, number);

comment on table campaign_phases is
  'ADR-0096 d.2: a campaign''s phases — numbered in the order listed (contiguous from 1), named, '
  'dated start and end. Phases of one campaign may overlap; nothing checks a phase against its '
  'neighbours. A phase carries no brief, approval, owner or department: it is where a deliverable '
  'sits in the campaign''s calendar, and a place to count.';

-- The TABLE privilege every table here needs and the migrations never granted (I43.2, traps.md:
-- "permission denied for table … with RLS never consulted"). Production's defaults grant these
-- four to authenticated on a new table; the local stack's do not. Explicit, as 20260913190000 is.
-- RLS is still the gate: the table has no write policy, so a direct insert is refused by it.
grant select, insert, update, delete on table public.campaign_phases to authenticated, service_role;

alter table campaign_phases enable row level security;
alter table campaign_phases force row level security;

-- Read by everyone in the tenant: the campaign page, the wizard, the schedule and Pipeline filters.
create policy campaign_phases_tenant_select on campaign_phases
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- No write policy on purpose: every write goes through the RPCs below (d.4), which carry the
-- campaign's approval authority. A direct insert/update/delete is refused by RLS.

create trigger set_updated_at before update on campaign_phases
  for each row execute function app.set_updated_at();

create trigger set_actor_columns
  before insert or update on campaign_phases
  for each row execute function app.set_actor_columns();

create trigger audit_row_change
  after insert or update or delete on campaign_phases
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 3) the column, and the invariant both ways
-- ============================================================================
alter table deliverables
  add column if not exists phase_id uuid references campaign_phases(id);

create index if not exists idx_deliverables_phase on deliverables (phase_id) where phase_id is not null;

comment on column deliverables.phase_id is
  'ADR-0096 d.3: the phase this deliverable sits in. Required when its campaign has phases, and '
  'must be one of that campaign''s; must be null when it does not. Held by '
  'app.tg_deliverable_phase_guard whichever door wrote it.';

-- The campaign a deliverable belongs to — through its stream or its job. Null for ad-hoc work.
create or replace function app.deliverable_campaign(p_deliverable uuid)
returns uuid language sql stable
set search_path = public, app, extensions as $$
  select coalesce(s.campaign_id, j.campaign_id)
    from public.deliverables d
    left join public.streams s on s.id = d.stream_id
    left join public.jobs    j on j.id = d.job_id
   where d.id = p_deliverable
$$;

comment on function app.deliverable_campaign(uuid) is
  'ADR-0096: the campaign a deliverable belongs to, via its stream or its job; null for ad-hoc work.';

-- The campaign's approval authority: the account manager, or projects:manage with reach over them.
-- The same test app.approve_campaign and add_campaign_deliverable make (ADR-0083 addendum d.14).
create or replace function app.is_campaign_authority(p_campaign uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, app.campaign_account_manager(p_campaign))
$$;

comment on function app.is_campaign_authority(uuid) is
  'ADR-0096 d.4: who may shape a campaign — its account manager, or projects:manage with reach '
  'over them (Power Admin, Traffic, an Account Director). The approval test, named.';

create or replace function app.tg_deliverable_phase_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_campaign uuid;
  v_on       boolean;
begin
  select coalesce(s.campaign_id, j.campaign_id) into v_campaign
    from (select 1) x
    left join public.streams s on s.id = new.stream_id
    left join public.jobs    j on j.id = new.job_id;

  if v_campaign is null then
    -- Ad-hoc work never carries a phase.
    if new.phase_id is not null then
      raise exception 'ad-hoc work does not belong to a phase' using errcode = '22023';
    end if;
    return new;
  end if;

  select c.has_phases into v_on from public.campaigns c where c.id = v_campaign;

  if v_on then
    if new.phase_id is null then
      raise exception 'this campaign runs in phases — every deliverable needs a phase'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.campaign_phases p
                    where p.id = new.phase_id and p.campaign_id = v_campaign) then
      raise exception 'that phase belongs to another campaign' using errcode = '22023';
    end if;
  elsif new.phase_id is not null then
    raise exception 'this campaign does not run in phases' using errcode = '22023';
  end if;

  -- Moving a deliverable between phases is the campaign's shape: the approval authority's call.
  -- (Insert is governed by whoever may insert — the wizard's writer, add_campaign_deliverable.)
  if tg_op = 'UPDATE' and new.phase_id is distinct from old.phase_id
     and auth.uid() is not null and not app.is_system_op()
     and not app.is_campaign_authority(v_campaign) then
    raise exception
      'moving this deliverable between phases is outside your reach — the account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_deliverable_phase_guard() is
  'ADR-0096 d.3/d.4: phases on => a deliverable names a phase of ITS campaign; phases off => none; '
  'ad-hoc work never. A move between phases needs the campaign''s approval authority. Held in '
  'Postgres so the wizard, the RPCs and a PATCH are governed identically (ADR-0037).';

drop trigger if exists deliverable_phase_guard on deliverables;
create trigger deliverable_phase_guard
  before insert or update of phase_id, stream_id, job_id on deliverables
  for each row execute function app.tg_deliverable_phase_guard();

-- ============================================================================
-- 4) the four doors
-- ============================================================================

-- ---- the toggle (d.5) ----
create or replace function public.set_campaign_phases(p_campaign uuid, p_enabled boolean)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaigns;
  v_phase  uuid;
  v_counts text;
  v_n      integer;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if not app.is_campaign_authority(p_campaign) then
    raise exception
      'changing how this campaign is phased is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if v.kind = 'single_job' then
    raise exception 'a single job does not run in phases' using errcode = '22023';
  end if;
  if v.status = 'closed' then
    raise exception 'this campaign is closed — reopen it first' using errcode = '22023';
  end if;
  if p_enabled = v.has_phases then
    return;
  end if;

  if p_enabled then
    update campaigns set has_phases = true where id = p_campaign;
    -- With deliverables present: one phase, from the campaign's creation day to its go-live day
    -- (or creation + 30 when unset), holding everything. With none: nothing — the first phase is
    -- entered by hand.
    if exists (select 1 from deliverables d
                join streams s on s.id = d.stream_id
               where s.campaign_id = p_campaign) then
      insert into campaign_phases (tenant_id, campaign_id, number, name, starts_on, ends_on)
      values (v_tenant, p_campaign, 1, 'Phase 1',
              (v.created_at at time zone 'Asia/Baghdad')::date,
              greatest(coalesce((v.go_live_at at time zone 'Asia/Baghdad')::date,
                                (v.created_at at time zone 'Asia/Baghdad')::date + 30),
                       (v.created_at at time zone 'Asia/Baghdad')::date))
      returning id into v_phase;
      update deliverables d set phase_id = v_phase
        from streams s
       where s.id = d.stream_id and s.campaign_id = p_campaign;
    end if;
    return;
  end if;

  -- Turning off: refused while more than one phase holds deliverables.
  select count(distinct d.phase_id) into v_n
    from deliverables d join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign and d.phase_id is not null;
  if v_n > 1 then
    select string_agg(format('%s in %s', c.n, p.name), ', ' order by p.number) into v_counts
      from (select d.phase_id, count(*) as n
              from deliverables d join streams s on s.id = d.stream_id
             where s.campaign_id = p_campaign and d.phase_id is not null
             group by d.phase_id) c
      join campaign_phases p on p.id = c.phase_id;
    raise exception 'move the deliverables into one phase first — %', v_counts using errcode = '22023';
  end if;
  update campaigns set has_phases = false where id = p_campaign;
  update deliverables d set phase_id = null
    from streams s
   where s.id = d.stream_id and s.campaign_id = p_campaign and d.phase_id is not null;
  delete from campaign_phases where campaign_id = p_campaign;
end $$;

comment on function public.set_campaign_phases(uuid, boolean) is
  'ADR-0096 d.5: turn phases on (one phase holding every existing deliverable) or off (refused '
  'while more than one phase holds deliverables). The campaign''s approval authority only.';

revoke execute on function public.set_campaign_phases(uuid, boolean) from public, anon;
grant  execute on function public.set_campaign_phases(uuid, boolean) to authenticated;

-- ---- add / edit a phase (d.2, d.6) ----
create or replace function public.save_campaign_phase(
  p_campaign uuid, p_phase uuid, p_name text, p_starts_on date, p_ends_on date)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaigns;
  v_id     uuid;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if not app.is_campaign_authority(p_campaign) then
    raise exception
      'changing this campaign''s phases is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if not v.has_phases then
    raise exception 'this campaign does not run in phases — turn phases on first' using errcode = '22023';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a phase needs a name' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'a phase needs a start and an end' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'a phase cannot end before it starts' using errcode = '22023';
  end if;

  if p_phase is null then
    insert into campaign_phases (tenant_id, campaign_id, number, name, starts_on, ends_on)
    values (v_tenant, p_campaign,
            coalesce((select max(number) from campaign_phases where campaign_id = p_campaign), 0) + 1,
            trim(p_name), p_starts_on, p_ends_on)
    returning id into v_id;
    return v_id;
  end if;

  update campaign_phases
     set name = trim(p_name), starts_on = p_starts_on, ends_on = p_ends_on
   where id = p_phase and campaign_id = p_campaign;
  if not found then
    raise exception 'phase not found' using errcode = 'P0002';
  end if;
  return p_phase;
end $$;

comment on function public.save_campaign_phase(uuid, uuid, text, date, date) is
  'ADR-0096 d.2/d.6: add a phase (p_phase null — at the next number) or rename / re-date one. '
  'Re-dating moves nothing and warns nothing. The campaign''s approval authority only.';

revoke execute on function public.save_campaign_phase(uuid, uuid, text, date, date) from public, anon;
grant  execute on function public.save_campaign_phase(uuid, uuid, text, date, date) to authenticated;

-- ---- delete a phase (d.6) ----
create or replace function public.delete_campaign_phase(p_phase uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaign_phases;
  v_n      integer;
  v_next   record;
begin
  select * into v from campaign_phases where id = p_phase and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'phase not found' using errcode = 'P0002';
  end if;
  if not app.is_campaign_authority(v.campaign_id) then
    raise exception
      'changing this campaign''s phases is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  select count(*) into v_n from deliverables where phase_id = p_phase;
  if v_n > 0 then
    raise exception 'this phase holds % deliverable% — move them to another phase first',
      v_n, case when v_n = 1 then '' else 's' end using errcode = '22023';
  end if;
  delete from campaign_phases where id = p_phase;
  -- Numbering stays contiguous: everything after it moves down one, lowest first, so the unique
  -- constraint never sees a collision (the deleted number is free before the next one lands on it).
  for v_next in select id from campaign_phases
                 where campaign_id = v.campaign_id and number > v.number
                 order by number
  loop
    update campaign_phases set number = number - 1 where id = v_next.id;
  end loop;
end $$;

comment on function public.delete_campaign_phase(uuid) is
  'ADR-0096 d.6: delete an EMPTY phase (one holding deliverables is refused with the count); the '
  'phases after it are renumbered down. The campaign''s approval authority only.';

revoke execute on function public.delete_campaign_phase(uuid) from public, anon;
grant  execute on function public.delete_campaign_phase(uuid) to authenticated;

-- ---- move a deliverable (d.4) ----
create or replace function public.move_deliverable_to_phase(p_deliverable uuid, p_phase uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
begin
  if not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
  v_campaign := app.deliverable_campaign(p_deliverable);
  if v_campaign is null then
    raise exception 'ad-hoc work does not belong to a phase' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(v_campaign) then
    raise exception
      'moving this deliverable between phases is outside your reach — the account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if not exists (select 1 from campaign_phases p where p.id = p_phase and p.campaign_id = v_campaign) then
    raise exception 'that phase belongs to another campaign' using errcode = '22023';
  end if;
  update deliverables set phase_id = p_phase where id = p_deliverable;
end $$;

comment on function public.move_deliverable_to_phase(uuid, uuid) is
  'ADR-0096 d.4: move a deliverable into another phase of its campaign. The campaign''s approval '
  'authority only; the guard trigger governs a PATCH identically.';

revoke execute on function public.move_deliverable_to_phase(uuid, uuid) from public, anon;
grant  execute on function public.move_deliverable_to_phase(uuid, uuid) to authenticated;

-- ============================================================================
-- 5) a date past the phase's end is recorded like one past go-live (d.7)
-- ============================================================================
-- The record gains WHICH boundary was crossed and its day. The existing 8-argument shape stays for
-- every caller that only knows go-live; the payload carries `boundary` either way.
create or replace function app.record_due_date_override(
  p_deliverable   uuid,
  p_due_day       date,
  p_severity      text,
  p_go_live_day   date,
  p_days_left     integer,
  p_required_days integer,
  p_outstanding_hours numeric default null,
  p_capacity_hours    numeric default null,
  p_boundary      text default 'go_live',
  p_boundary_day  date default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
begin
  -- ADR-0093 added after_go_live; ADR-0096 d.7 adds after_phase_end.
  if p_severity not in ('tight', 'impossible', 'after_go_live', 'after_phase_end') then
    raise exception using errcode = 'check_violation',
      message = 'an override is recorded only for a tight, impossible, after-go-live or after-phase-end date';
  end if;
  if p_boundary not in ('go_live', 'phase_end') then
    raise exception 'boundary must be go_live or phase_end' using errcode = '22023';
  end if;
  if not exists (select 1 from deliverables d where d.id = p_deliverable and d.tenant_id = v_tenant) then
    raise exception 'deliverable_not_found' using errcode = 'no_data_found';
  end if;
  insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id, payload)
  values (v_tenant, p_deliverable, 'due_date_override', auth.uid(),
          jsonb_build_object(
            'due_day', p_due_day,
            'go_live_day', p_go_live_day,
            'boundary', p_boundary,
            'boundary_day', coalesce(p_boundary_day, p_go_live_day),
            'severity', p_severity,
            'working_days_left', p_days_left,
            'required_days', p_required_days,
            'outstanding_hours', p_outstanding_hours,
            'capacity_hours', p_capacity_hours))
  returning id into v_id;
  return v_id;
end $$;

drop function if exists app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric);

create or replace function public.record_due_date_override(
  p_deliverable   uuid,
  p_due_day       date,
  p_severity      text,
  p_go_live_day   date,
  p_days_left     integer,
  p_required_days integer,
  p_outstanding_hours numeric default null,
  p_capacity_hours    numeric default null,
  p_boundary      text default 'go_live',
  p_boundary_day  date default null
) returns uuid
language sql
security invoker
set search_path = public, app, extensions as $$
  select app.record_due_date_override(p_deliverable, p_due_day, p_severity, p_go_live_day,
                                      p_days_left, p_required_days, p_outstanding_hours, p_capacity_hours,
                                      p_boundary, p_boundary_day);
$$;

drop function if exists public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric);

comment on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric, text, date) is
  'ADR-0075 d.9 / ADR-0093 / ADR-0096 d.7: the record of a person proceeding past a tight, '
  'impossible, after-go-live or after-phase-end due-date warning. p_boundary says which line was '
  'crossed (go_live | phase_end) and p_boundary_day its day.';

revoke execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric, text, date) from public, anon;
grant  execute on function public.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric, text, date) to authenticated;
revoke execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric, text, date) from public;
grant  execute on function app.record_due_date_override(uuid, date, text, date, integer, integer, numeric, numeric, text, date) to authenticated;

-- ============================================================================
-- 6) the wizard writes phases (d.8)
-- ============================================================================
-- Reproduced from 20260914130000 with p_phases and phaseNumber added. p_phases is a JSON array of
-- { number, name, startsOn, endsOn }; when it is non-empty the campaign runs in phases and every
-- deliverable row must carry phaseNumber (the guard refuses one that does not).
drop function if exists app.write_campaign_content(uuid, jsonb, timestamptz, jsonb);

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
      deliverable_type_id, quantity, channel, format, phase_id
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
      end
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

-- The one insert into campaign_phases the wizard makes. Definer because the table has no write
-- policy; the caller is the campaign's creator, writing the campaign they are creating.
create or replace function app.insert_campaign_phase(
  p_tenant uuid, p_campaign uuid, p_number integer, p_name text, p_starts_on date, p_ends_on date)
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
  insert into campaign_phases (tenant_id, campaign_id, number, name, starts_on, ends_on)
  values (p_tenant, p_campaign, p_number, trim(p_name), p_starts_on, p_ends_on)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function app.insert_campaign_phase(uuid, uuid, integer, text, date, date) from public;
grant  execute on function app.insert_campaign_phase(uuid, uuid, integer, text, date, date) to authenticated;

-- complete_campaign_draft: reproduced from 20260903100100 with p_phases.
drop function if exists public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb);

create or replace function public.complete_campaign_draft(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb,
  p_phases       jsonb default null
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

  perform app.write_campaign_content(p_campaign, p_brief, p_go_live, p_deliverables, p_phases);

  update campaigns set status = 'pending_approval'
   where id = p_campaign and tenant_id = v_tenant;

  return p_campaign;
end $$;

comment on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb) is
  'ADR-0067 d.4, with ADR-0096 d.8: the wizard''s submit. Writes the brief, the phases, the stream '
  'and the deliverables through app.write_campaign_content, then draft -> pending_approval.';

revoke execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb) from public, anon;
grant  execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb, jsonb) to authenticated;

-- create_campaign_from_brief: reproduced from 20260911130000 with p_phases.
drop function if exists public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text);

create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb,
  p_account_manager uuid default null,
  p_kind text default 'campaign',
  p_phases jsonb default null
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

  perform app.write_campaign_content(v_campaign, p_brief, p_go_live, p_deliverables, p_phases);

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb) is
  'ADR-0020 as revised by ADR-0050/0051, ADR-0067, ADR-0086 d.8 and ADR-0096 d.8: the ONE-SHOT '
  'path. p_phases is the wizard''s Phases step; a single job may not pass one.';

revoke execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb) from public, anon;
grant  execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text, jsonb) to authenticated;

-- ============================================================================
-- 7) add_campaign_deliverable takes the phase (d.8 — the campaign page's door)
-- ============================================================================
drop function if exists public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb);

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

  if p_due_override is not null and jsonb_typeof(p_due_override) = 'object' and p_due_at is not null then
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
  'I52.20 with ADR-0096 d.8: add a deliverable to an existing campaign or job, under the approval '
  'authority. p_phase is required when the campaign runs in phases; ignored when it does not.';

revoke execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid) from public, anon;
grant  execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid) to authenticated;

commit;
