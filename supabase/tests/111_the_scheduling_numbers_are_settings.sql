-- I41.10 (ADR-0075 d.5) — the scheduling numbers are settings.
--
-- Properties:
--   * the three columns exist with the measured defaults (2, 4, 1), so a tenant that never opens
--     the screen behaves as ADR-0075 describes;
--   * a Power Admin (organization:manage) changes them; a scheduler (no organization:manage) cannot;
--   * everyone in the tenant can READ them — the numbers decide what a screen shows;
--   * a nonsense value is refused by the CHECK;
--   * tenant B cannot see tenant A's row.
begin;
select plan(8);
\ir helpers/seed.sql

-- The fixture tenants are inserted after the migration's back-fill ran, so provision their row
-- the way a new tenant gets it.
select app.seed_tenant_reminder_settings('aaaaaaaa-0000-0000-0000-000000000001');
select app.seed_tenant_reminder_settings('bbbbbbbb-0000-0000-0000-000000000001');

select has_column('public', 'tenant_reminder_settings', 'delivery_days_before_go_live', 'delivery offset is a column');
select has_column('public', 'tenant_reminder_settings', 'commence_days_before_delivery', 'commence offset is a column');
select has_column('public', 'tenant_reminder_settings', 'review_buffer_working_days', 'review buffer is a column');

select results_eq($$
  select delivery_days_before_go_live, commence_days_before_delivery, review_buffer_working_days
  from tenant_reminder_settings where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, $$ values (2, 4, 1) $$, 'the defaults are the measured 2 / 4 / 1');

set local role authenticated;

-- The scheduler holds no organization:manage — the UPDATE is filtered to nothing under RLS.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
update tenant_reminder_settings set delivery_days_before_go_live = 5
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is(
  (select delivery_days_before_go_live from tenant_reminder_settings where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'a scheduler cannot change the numbers (no organization:manage) — but can read them');

-- The Power Admin can.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$
  update tenant_reminder_settings set delivery_days_before_go_live = 3, commence_days_before_delivery = 5, review_buffer_working_days = 2
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, 'a Power Admin changes the numbers');
select throws_ok($$
  update tenant_reminder_settings set delivery_days_before_go_live = -1
    where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
$$, '23514', null, 'a negative offset is refused');

-- Tenant B sees nothing of A.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select is(
  (select count(*)::int from tenant_reminder_settings where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0, 'tenant B cannot read tenant A''s settings');

select * from finish();
rollback;
