-- M1.8 accountability-ready event logs (§5.5): append-only from day one.
-- Once outcomes affect rewards, records become contestable — so events are an
-- immutable log: INSERT-only policies, and UPDATE/DELETE revoked outright.
-- No updated_at column on purpose: these rows never change.

create type attribution_party as enum ('assignee', 'client', 'dependency', 'approver');

create table sla_events (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  deliverable_id  uuid references deliverables(id),
  job_id          uuid references jobs(id),
  booking_id      uuid references bookings(id),
  event_type      text not null check (event_type in (
                    'deadline_set', 'deadline_changed', 'scope_change',
                    'clock_paused', 'clock_resumed',
                    'blocked_flagged', 'block_cleared',
                    'delivered', 'revision_requested', 'approved'
                  )),
  attributed_to   attribution_party,
  actor_user_id   uuid references user_profiles(id),
  payload         jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  constraint chk_sla_events_has_subject
    check (deliverable_id is not null or job_id is not null or booking_id is not null)
);
create index idx_sla_events_tenant_id on sla_events (tenant_id);
create index idx_sla_events_deliverable_id on sla_events (deliverable_id);
create index idx_sla_events_job_id on sla_events (job_id);
create index idx_sla_events_booking_id on sla_events (booking_id);
create index idx_sla_events_created_at on sla_events (created_at);

alter table sla_events enable row level security;
alter table sla_events force row level security;

create policy sla_events_tenant_select on sla_events
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
create policy sla_events_tenant_insert on sla_events
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and actor_user_id = auth.uid());
-- NO update/delete policies — and belt-and-braces at the grant level:
revoke update, delete on sla_events from authenticated, anon;

create table audit_events (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  actor_user_id  uuid references user_profiles(id),
  action         text not null,
  entity         text not null,
  entity_id      uuid,
  payload        jsonb not null default '{}',
  created_at     timestamptz not null default now()
);
create index idx_audit_events_tenant_id on audit_events (tenant_id);
create index idx_audit_events_entity on audit_events (entity, entity_id);
create index idx_audit_events_created_at on audit_events (created_at);

alter table audit_events enable row level security;
alter table audit_events force row level security;

create policy audit_events_admin_select on audit_events
  for select to authenticated
  using (tenant_id = app.current_tenant_id()
         and app.jwt_role() in ('admin', 'team_lead'));
create policy audit_events_tenant_insert on audit_events
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and actor_user_id = auth.uid());
revoke update, delete on audit_events from authenticated, anon;
