-- I41.10 (ADR-0075 d.5, ADR-0066 d.8) — the scheduling numbers are admin-adjustable settings.
--
-- Edward, 9 Sep: *"please ensure the 2 days prior and 4 days prior are included as admin adjustable
-- settings."* Three numbers, all hard-coded until now:
--
--   * DELIVERY_DAYS_BEFORE_GO_LIVE (2) — go-live minus this many WORKING days is the delivery
--     (approval) deadline; also the window inside which a typed due date WARNS (I41.8, ADR-0075 d.9);
--   * COMMENCE_DAYS_BEFORE_DELIVERY (4) — delivery minus this many working days is when work must
--     start;
--   * the review buffer (1 working day, ADR-0075 d.5) — what an extension request's arithmetic
--     subtracts from the days left before the deliverable's deadline (ADR-0088 d.7).
--
-- `tenant_reminder_settings` is the home ADR-0066 d.8 built for exactly this shape of value —
-- per tenant, read by everyone (the numbers decide what a screen shows), written behind
-- `organization:manage`. The three columns land there; Admin → Organization gains the section
-- that edits them. Defaults are the measured values, so a tenant that never opens the screen
-- behaves exactly as ADR-0075 describes.
--
-- WORKING DAYS, unlike the T+ threshold beside them, which is wall-clock on purpose (ADR-0066 d.7).
-- These three are agency-internal planning offsets; the T+ figure is a promise to a client.
--
-- Per-department review buffers (ADR-0075 d.5 "per-department admin setting") are NOT built here:
-- one tenant-wide number first, a department override when somebody needs one.
--
-- Tests: supabase/tests/111_the_scheduling_numbers_are_settings.sql

begin;

alter table tenant_reminder_settings
  add column delivery_days_before_go_live integer not null default 2
    check (delivery_days_before_go_live between 0 and 60),
  add column commence_days_before_delivery integer not null default 4
    check (commence_days_before_delivery between 0 and 120),
  add column review_buffer_working_days integer not null default 1
    check (review_buffer_working_days between 0 and 30);

comment on column tenant_reminder_settings.delivery_days_before_go_live is
  'ADR-0075 d.5 / I41.10: go-live minus this many WORKING days is the delivery (approval) deadline, '
  'and a due date inside this window warns (d.9). Default 2 (Edward, 29 Aug / 9 Sep).';
comment on column tenant_reminder_settings.commence_days_before_delivery is
  'I41.10: delivery minus this many WORKING days is when work must start. Default 4.';
comment on column tenant_reminder_settings.review_buffer_working_days is
  'ADR-0075 d.5 / ADR-0088 d.7: working days of review a department needs after the last task '
  'lands, subtracted in the extension arithmetic. Default 1, tenant-wide.';

commit;
