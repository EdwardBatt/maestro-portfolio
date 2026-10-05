-- I35.5 (ADR-0066) — a brief receipt is fenced like its campaign, and the two timestamps it carries
-- cannot be forged.
--
-- Three properties matter here and each is proved separately.
--
-- 1. ORDINARY FENCING. Tenant isolation, and a write grant that matches the campaign's rather than
--    being wider — a receipt is a property of the campaign, so recording one is the same job.
--
-- 2. `captured_at` CANNOT BE BACK-DATED. It is when the server saw the screenshot. If a caller can
--    set it, a late brief can be made to look prompt by claiming the screenshot arrived earlier,
--    and the measurement is worthless. The trigger overwrites whatever is sent, on INSERT and on
--    UPDATE alike.
--
-- 3. A CONFIRMED RECEIPT IS COMPLETE, AND `confirmed_by` IS NOT SELF-DECLARED. ADR-0066 d.5 makes
--    confirmation the thing that starts the clock, which makes "who said so" the column an argument
--    would turn on. It comes from auth.uid(), never from the payload — and the CHECK refuses a
--    confirmation that has no timestamp behind it, because a confirmed receipt with no received_at
--    would be a clock with no origin.
--
-- `received_at` is deliberately NOT stamped or defaulted anywhere: it is read off the image and is
-- the one timestamp a person is allowed to state. A test asserting otherwise would be asserting the
-- bug ADR-0066 d.5 exists to prevent.
--
-- Every case runs as `authenticated` with the caller's own JWT claims, never as superuser: the
-- policies read `app.current_tenant_id()` and `app.has_permission()`, so a superuser run would
-- prove nothing at all.
begin;
select plan(14);
\ir helpers/seed.sql

-- ---------------------------------------------------------------- extra fixtures ----
insert into campaigns (id, tenant_id, client_id, name, status) values
  ('bbbbbbbb-0000-0000-0000-00000000e001','bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000c001','B Campaign','approved');

insert into campaign_brief_receipts (id, tenant_id, campaign_id, subject, received_at, received_tz) values
  ('aaaaaaaa-0000-0000-0000-0000000fa001','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Ramadan brief','2026-09-01 10:32+04','Asia/Dubai'),
  ('bbbbbbbb-0000-0000-0000-0000000fa001','bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000e001','B brief','2026-09-01 10:32+04','Asia/Dubai');

-- ---------------------------------------------------------------- shape ----
select has_table('public','campaign_brief_receipts','the table exists');
select col_not_null('public','campaign_brief_receipts','tenant_id','tenant_id is NOT NULL — no unfenced row');

-- d.1 said one receipt per campaign, and `campaign_id` was UNIQUE until `20260911130400`.
-- ADR-0086 d.5/d.6 overturns that for one case: a job attached to the one it duplicates brings
-- its receipt with it, so a campaign carries a TRAIL and the clock reads the earliest confirmed
-- row. The uniqueness is gone; what remains is the index the trail is read through. Test 101
-- proves the order and that the clock's origin does not move.
select has_index('public','campaign_brief_receipts','idx_campaign_brief_receipts_campaign',
  'receipts are read as a trail per campaign, in arrival order (ADR-0086 d.5)');

-- d.13: a partial timestamp stays partial. A NOT NULL here would force the model to guess at a
-- `14:32` with no date, which d.4 forbids it from doing.
select col_is_null('public','campaign_brief_receipts','received_at',
  'received_at is NULLABLE — a partial timestamp is a legitimate state a person is about to finish (d.13)');

-- d.2: deleting the screenshot must not delete the record that a brief was received.
select throws_ok($$
  insert into campaign_brief_receipts (tenant_id, campaign_id, confirmed_at)
  values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-00000000e001', now())
$$, '23514', null,
  'a confirmed receipt with no received_at is refused — a clock with no origin is not a clock');

-- ---------------------------------------------------------------- read ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*) from campaign_brief_receipts)::int, 1,
  'a Team Member with no projects:manage still READS — evidence only its filer can see is not evidence');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is((select count(*) from campaign_brief_receipts where tenant_id='aaaaaaaa-0000-0000-0000-000000000001')::int, 0,
  'tenant B cannot see tenant A''s receipts');

-- ---------------------------------------------------------------- write ----
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- The back-dating attempt, which is the attack this table has to survive: a caller claiming the
-- screenshot reached us long ago, so a slow brief looks prompt.
select lives_ok($$
  update campaign_brief_receipts
     set captured_at = '2020-01-01 00:00+00'
   where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'
$$, 'projects:manage may edit a receipt — the fields are corrected by hand (d.13)');

select cmp_ok(
  (select captured_at from campaign_brief_receipts where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'),
  '>', '2026-01-01 00:00+00'::timestamptz,
  'captured_at CANNOT be back-dated — the trigger keeps the server''s own value');

select is(
  (select received_at from campaign_brief_receipts where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'),
  '2026-09-01 10:32+04'::timestamptz,
  'received_at is untouched by the trigger — it is read off the image, not stamped (d.5)');

-- Confirmation: stamped from auth.uid(), whatever the payload claimed.
select lives_ok($$
  update campaign_brief_receipts
     set confirmed_at = '2020-01-01 00:00+00',
         confirmed_by = '00000000-0000-0000-0000-00000000a003'
   where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'
$$, 'a receipt can be confirmed');

select is(
  (select confirmed_by from campaign_brief_receipts where id = 'aaaaaaaa-0000-0000-0000-0000000fa001'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'confirmed_by is stamped from auth.uid() — naming somebody else is simply overwritten (d.5)');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$
  insert into campaign_brief_receipts (tenant_id, campaign_id, subject)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','x')
$$, '42501', null, 'a reader without projects:manage may not record a receipt');

-- Cross-tenant write with a forged tenant_id: the WITH CHECK fences it, not the caller's honesty.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($$
  insert into campaign_brief_receipts (tenant_id, campaign_id, subject)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','x')
$$, '42501', null, 'tenant B cannot write a receipt into tenant A');

select * from finish();
rollback;
