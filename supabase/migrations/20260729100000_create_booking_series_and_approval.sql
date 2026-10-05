-- M4.2/M4.3: approval requirement flag + recurrence (series vs instance — the
-- LibreBooking pattern, §9.1). The series is the logical booking; instances
-- are concrete bookings carrying series_id. Instances are what capacity,
-- approval, and the exclusion constraint see — the series is bookkeeping.

alter table resources
  add column requires_approval boolean not null default false;

comment on column resources.requires_approval is
  'When true, new bookings enter tentative and need team_lead/admin approval to confirm (§4.2/§9.1).';

create table booking_series (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  resource_id     uuid not null references resources(id),
  created_by      uuid references user_profiles(id),
  freq            text not null check (freq in ('weekly')),
  interval_weeks  integer not null default 1 check (interval_weeks between 1 and 8),
  repeat_count    integer not null check (repeat_count between 2 and 52),
  first_starts_at timestamptz not null,
  first_ends_at   timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_booking_series_span check (first_ends_at > first_starts_at)
);
create index idx_booking_series_tenant_id on booking_series (tenant_id);
create index idx_booking_series_resource_id on booking_series (resource_id);

alter table booking_series enable row level security;
alter table booking_series force row level security;

create policy booking_series_tenant_select on booking_series
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy booking_series_scheduler_write on booking_series
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead', 'booker'))
  with check (tenant_id = app.current_tenant_id()
              and app.jwt_role() in ('admin', 'team_lead', 'booker'));

create trigger set_updated_at before update on booking_series
  for each row execute function app.set_updated_at();

alter table bookings
  add column series_id uuid references booking_series(id);
create index idx_bookings_series_id on bookings (series_id);
