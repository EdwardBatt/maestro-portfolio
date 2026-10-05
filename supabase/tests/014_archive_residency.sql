-- ADR-0023 internal-round lifecycle + per-tenant archive residency.
-- AMENDED by ADR-0136 d.1 (I72): the 60-day clock on replaced rounds is RETIRED — a replaced round is
-- still marked superseded, but no clock starts and the old due-set is always empty.
--   * default per-tenant storage settings (cloud target);
--   * a new review round marks prior UNDELIVERED rounds superseded — and starts no clock;
--   * delivered rounds are EXEMPT from the clock;
--   * the due-for-archive helper returns only undelivered, active, past-due rounds;
--   * tenant_storage_settings is admin-write (organization:manage), tenant-read.
begin;
select plan(10);
\ir helpers/seed.sql
select app.seed_tenant_storage_settings(id) from tenants;

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000a311', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001', 'Lifecycle');

-- Deliverable S: two undelivered internal rounds (supersession path).
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000a411', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a311', 'Cutdown', 'draft', '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-00000000a511', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a411', 1, 's/v1');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-00000000a512', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a411', 2, 's/v2');   -- fires the supersession trigger on v1

-- Deliverable D: a delivered round, then a newer round (delivered-exemption path).
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-00000000a421', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a311', 'Master', 'draft', '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-00000000a521', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a421', 1, 'd/v1');
update media_records set delivered_at = now(), delivery_round = 1
  where id = 'aaaaaaaa-0000-0000-0000-00000000a521';   -- mark delivered before the next round
insert into media_records (id, tenant_id, deliverable_id, version, object_key) values
  ('aaaaaaaa-0000-0000-0000-00000000a522', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000a421', 2, 'd/v2');   -- must NOT put the delivered v1 on the clock

-- ---- settings defaults ----
select is((select working_retention_days from tenant_storage_settings
             where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  60, 'default working-round retention is 60 days');
select is((select archive_target from tenant_storage_settings
             where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'cloud', 'default archive target is cloud');

-- ---- supersession clock ----
select ok((select superseded_at is not null from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a511'),
  'prior undelivered round v1 is superseded by v2');
select ok((select archive_due_at is null
             from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a511'),
  'ADR-0136 d.1: the replaced v1 starts NO archive clock (the 60-day rule is retired)');
select ok((select archive_due_at is null from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a512'),
  'current head v2 is not on the clock');
select ok((select archive_due_at is null from media_records where id = 'aaaaaaaa-0000-0000-0000-00000000a521'),
  'delivered round is EXEMPT from the archive clock');

-- ---- due-for-archive helper ----
update media_records set archive_due_at = now() - interval '1 day'
  where id = 'aaaaaaaa-0000-0000-0000-00000000a511';                 -- undelivered, now past due
update media_records set archive_due_at = now() - interval '1 day'
  where id = 'aaaaaaaa-0000-0000-0000-00000000a521';                 -- delivered + past due (must be ignored)
select is(
  (select count(*)::int from app.media_records_due_for_archive()
    where id = 'aaaaaaaa-0000-0000-0000-00000000a511'),
  0, 'ADR-0136 d.1: the retired due-set returns nothing, even a past-due undelivered round');
select is(
  (select count(*)::int from app.media_records_due_for_archive()
    where id = 'aaaaaaaa-0000-0000-0000-00000000a521'),
  0, 'delivered round is never returned for archiving, even past due');

-- ---- settings RLS: admin-write, non-admin blocked ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);  -- team_member
update tenant_storage_settings set working_retention_days = 5
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';   -- RLS: matches 0 rows
select is((select working_retention_days from tenant_storage_settings
             where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  60, 'team_member cannot change archive settings (RLS blocked)');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);  -- power_admin
update tenant_storage_settings set working_retention_days = 30
  where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
select is((select working_retention_days from tenant_storage_settings
             where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  30, 'organization:manage holder can change archive settings');

select * from finish();
rollback;
