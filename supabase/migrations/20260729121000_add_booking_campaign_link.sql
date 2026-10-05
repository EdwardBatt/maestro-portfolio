-- ADR-0006: the booking popup selects a project (campaign) directly. Before
-- the brief system (V1.7) exists, bookings need a campaign link that doesn't
-- route through deliverables — same optional-link philosophy as ad-hoc jobs
-- (§8.1): set when known, null is normal.
alter table bookings
  add column campaign_id uuid references campaigns(id);
create index idx_bookings_campaign_id on bookings (campaign_id);
