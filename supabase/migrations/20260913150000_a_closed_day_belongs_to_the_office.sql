-- I41.11 / I41.12 (ADR-0079) — a closed day belongs to the office, not to each person.
--
-- Until now a public holiday could only be entered as `resource_unavailability` rows, one per
-- person, kind 'holiday'. Anyone hired after the entry silently had no closure and was bookable
-- across Eid. ADR-0079 d.1 puts the closure on the OFFICE: one row per closure per office, keyed by
-- tenant + office + date span, and a person hired tomorrow is covered tonight because nothing about
-- the row mentions people.
--
-- d.2 — a public holiday and a company-closed day are the same thing; they differ in the label and
--       nothing else, so one table and one `kind` column.
-- d.4 — `OfficeCalendar` in the frontend carries these dates, and every "is this a working day"
--       decision reads them through that one type. Nothing in SQL re-derives working days; the SQL
--       here only stores the fact and answers "what is booked on a closed day" (d.6).
-- d.5 — declaring a closure moves NO booking. There is no trigger on this table that touches
--       bookings, on purpose.
-- d.6 — but the stranded work is LISTED: `office_closure_stranded_bookings` returns every booking
--       on that office's resources that touches a closed day, with its owner, so a person can drag
--       each one knowingly. The drop warns exactly as I41.5 made it warn.
-- d.7 — writes are behind `leave:manage`, the HR grant; reads are tenant-wide because every
--       schedule reader needs to know which days are closed.
-- d.8 — dates are entered by hand. No import, no feed.
--
-- ALSO: the `'holiday'` arm of ADR-0013's leave policy is retired here (ADR-0079 asks for it in the
-- same migration). The leave form no longer offers "holiday"; existing 'holiday' rows are left as
-- they are — they are history, they still shade the grid as unavailability, and converting
-- per-person rows into office rows would be guessing which office each one meant. `kind` keeps
-- 'holiday' in its CHECK for that reason; only the WRITE policy narrows.
--
-- Tests: supabase/tests/110_a_closed_day_belongs_to_the_office.sql (and 012 amended).

begin;

-- ============================================================================
-- 1) the table
-- ============================================================================
create table office_closures (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  office_id   uuid not null references offices(id) on delete cascade,
  -- Whole days, in the office's own calendar (ADR-0079 "what this does not decide": no half days).
  -- A DATE, not a timestamptz: a closure is a chosen day, not a moment, and storing it as midnight
  -- UTC is the trap traps.md calls "a deadline is a DAY stored as a MOMENT".
  starts_on   date not null,
  ends_on     date not null,
  kind        text not null check (kind in ('public_holiday', 'company_closed')),
  name        text not null check (length(trim(name)) > 0),
  -- Who entered it (d.8: a small, deliberate, audited row entered by the person whose job it is).
  -- Stamped by trigger from auth.uid(), never from the payload.
  created_by  uuid references user_profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chk_office_closures_span check (ends_on >= starts_on)
);

create index idx_office_closures_tenant_id on office_closures (tenant_id);
create index idx_office_closures_office_span on office_closures (office_id, starts_on, ends_on);

comment on table office_closures is
  'ADR-0079: a day the OFFICE does not work — public holiday or company closure. Keyed by office, '
  'never by person, so everyone in the office (including people hired later) is covered. Read '
  'tenant-wide; written behind leave:manage. Declaring one moves no booking (d.5).';
comment on column office_closures.kind is
  'ADR-0079 d.2: public_holiday and company_closed are the same fact with a different label.';

alter table office_closures enable row level security;
alter table office_closures force row level security;

-- Read by everyone in the tenant: the grid, the spreader and the capacity preview all need it.
create policy office_closures_tenant_select on office_closures
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- Written by HR (d.7). The office must be one of this tenant's — a plain FK is not a tenant fence
-- (traps.md), so the check says so explicitly.
create policy office_closures_leave_write on office_closures
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('leave', 'manage'))
  with check (
    tenant_id = app.current_tenant_id()
    and app.has_permission('leave', 'manage')
    and exists (select 1 from offices o where o.id = office_id and o.tenant_id = app.current_tenant_id())
  );

create trigger set_updated_at before update on office_closures
  for each row execute function app.set_updated_at();

create trigger audit_row_change
  after insert or update or delete on office_closures
  for each row execute function app.audit_row_change();

create or replace function app.tg_office_closure_stamp_creator()
returns trigger language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  new.created_by := auth.uid();
  return new;
end $$;

create trigger office_closure_stamp_creator
  before insert on office_closures
  for each row execute function app.tg_office_closure_stamp_creator();

-- ============================================================================
-- 2) "is the office closed that day" — the one SQL-side reader
-- ============================================================================
-- The frontend reads closures through OfficeCalendar (d.4). SQL has one question of its own to
-- answer — the stranded list below, and pgTAP's "a resource created AFTER the closure is covered".
create or replace function app.is_office_closed(p_office uuid, p_day date)
returns boolean
language sql stable security invoker
set search_path = public, app, extensions as $$
  select exists (
    select 1 from office_closures c
    where c.office_id = p_office and p_day between c.starts_on and c.ends_on
  )
$$;

-- ============================================================================
-- 3) the stranded list (d.6)
-- ============================================================================
-- Every booking on one of this office's resources that touches a day inside the closure. The
-- booking's span is read in the OFFICE's timezone so a booking ending at 00:00 local the next day
-- is not counted as touching it. Security invoker: the caller sees only bookings RLS lets them see.
create or replace function public.office_closure_stranded_bookings(p_closure uuid)
returns table (
  booking_id      uuid,
  resource_id     uuid,
  resource_name   text,
  title           text,
  starts_at       timestamptz,
  ends_at         timestamptz,
  sub_task_id     uuid,
  deliverable_id  uuid,
  deliverable_name text,
  owner_user_id   uuid,
  owner_name      text
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select
    b.id,
    r.id,
    r.name,
    b.title,
    b.starts_at,
    b.ends_at,
    b.sub_task_id,
    d.id,
    d.name,
    r.user_id,
    up.display_name
  from office_closures c
  join offices o on o.id = c.office_id
  join resources r on r.office_id = c.office_id and r.tenant_id = c.tenant_id
  join bookings b on b.resource_id = r.id
  left join deliverables d on d.id = b.deliverable_id
  left join user_profiles up on up.id = r.user_id
  where c.id = p_closure
    and b.state <> 'cancelled'
    -- The booking's local days overlap the closed days. `[starts_on, ends_on + 1)` in the office
    -- zone against the booking's `[starts_at, ends_at)`.
    and tstzrange(b.starts_at, b.ends_at, '[)') &&
        tstzrange((c.starts_on::timestamp) at time zone o.timezone,
                  ((c.ends_on + 1)::timestamp) at time zone o.timezone, '[)')
  order by b.starts_at, r.name
$$;

revoke execute on function public.office_closure_stranded_bookings(uuid) from public, anon;
grant  execute on function public.office_closure_stranded_bookings(uuid) to authenticated;

-- ============================================================================
-- 4) the leave policy loses its 'holiday' arm (ADR-0079)
-- ============================================================================
-- Reproduced from 20260813090000_leave_grant_and_category.sql, minus 'holiday'. A holiday is an
-- office closure now; a per-person row of that kind can no longer be written.
drop policy if exists resource_unavailability_leave_write on resource_unavailability;
create policy resource_unavailability_leave_write on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.has_permission('leave', 'manage')
         and kind = 'leave'
         and app.resource_in_write_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
              and app.has_permission('leave', 'manage')
              and kind = 'leave'
              and app.resource_in_write_scope(resource_id));

commit;
