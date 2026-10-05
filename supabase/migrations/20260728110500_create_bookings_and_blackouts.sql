-- M1.6 bookings: flexible states in app logic, ONE hard invariant in the DB —
-- no two confirmed bookings overlap for an exclusive resource (§4.2), enforced
-- physically (race-proof) by an exclusion constraint.
-- M1.7 blackouts: unavailability as its own concept, separate from bookings (§4.3).

create type booking_state as enum
  ('soft_hold', 'tentative', 'confirmed', 'cancelled', 'expired');

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),  -- tenant-tagged allocation (§10.4)
  resource_id      uuid not null references resources(id),
  booked_by        uuid references user_profiles(id),
  deliverable_id   uuid references deliverables(id),
  job_id           uuid references jobs(id),
  work_type_id     uuid references work_types(id),        -- null ⇒ never enters SLA machinery (§5.3)
  state            booking_state not null default 'tentative',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  timespan         tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  load_pct         numeric(5,1) check (load_pct is null or load_pct > 0),  -- load-based humans
  soft_hold_expires_at timestamptz,   -- soft_hold only; expiry handled by Edge Function
  notes            text,
  is_exclusive     boolean not null default false,  -- trigger-maintained copy of the resource's model
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint chk_bookings_span check (ends_at > starts_at),
  constraint chk_bookings_soft_hold_expiry
    check (state <> 'soft_hold' or soft_hold_expires_at is not null)
);
create index idx_bookings_tenant_id on bookings (tenant_id);
create index idx_bookings_resource_id on bookings (resource_id);
create index idx_bookings_deliverable_id on bookings (deliverable_id);
create index idx_bookings_job_id on bookings (job_id);
create index idx_bookings_work_type_id on bookings (work_type_id);
create index idx_bookings_booked_by on bookings (booked_by);
create index idx_bookings_timespan on bookings using gist (resource_id, timespan);

-- Keep is_exclusive true to the resource's capacity model. SECURITY of this
-- copy: maintained only by trigger, never client-writable in any meaningful
-- way (a lying client value is overwritten before row storage).
create or replace function app.set_booking_exclusivity() returns trigger
language plpgsql as $$
begin
  select (r.capacity_model = 'exclusive') into strict new.is_exclusive
  from resources r where r.id = new.resource_id;
  return new;
end $$;

create trigger set_booking_exclusivity
  before insert or update of resource_id on bookings
  for each row execute function app.set_booking_exclusivity();

-- THE hard invariant (§4.2): confirmed + exclusive ⇒ no overlap. Everything
-- else (soft-holds, tentatives, load accumulation) is application logic.
alter table bookings add constraint excl_bookings_confirmed_exclusive_overlap
  exclude using gist (resource_id with =, timespan with &&)
  where (state = 'confirmed' and is_exclusive);

alter table bookings enable row level security;
alter table bookings force row level security;

create policy bookings_tenant_select on bookings
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));
create policy bookings_scheduler_delete on bookings
  for delete to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'));

create trigger set_updated_at before update on bookings
  for each row execute function app.set_updated_at();

-- Blackouts / unavailability (§4.3): leave, maintenance, holidays. Its own
-- concept — never modeled as bookings, never consumes capacity.
create table resource_unavailability (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  resource_id  uuid not null references resources(id),
  kind         text not null check (kind in ('leave', 'maintenance', 'holiday', 'other')),
  reason       text,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  timespan     tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint chk_unavailability_span check (ends_at > starts_at)
);
create index idx_resource_unavailability_tenant_id on resource_unavailability (tenant_id);
create index idx_resource_unavailability_resource_id on resource_unavailability (resource_id);
create index idx_resource_unavailability_timespan
  on resource_unavailability using gist (resource_id, timespan);

alter table resource_unavailability enable row level security;
alter table resource_unavailability force row level security;

create policy resource_unavailability_tenant_select on resource_unavailability
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy resource_unavailability_scheduler_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));

create trigger set_updated_at before update on resource_unavailability
  for each row execute function app.set_updated_at();
