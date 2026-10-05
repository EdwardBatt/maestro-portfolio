-- ADR-0135 (I72) — a job or campaign name that differs from another only by capitals or spaces is taken.
--
--   the second is refused with 23505 (what the wizard and the single-job flow already map), whether it is
--   created or renamed into the clash; capitals, leading / trailing / repeated spaces do not distinguish;
--   a real difference ("cards") does; another tenant may use the name; a closed duplicate folded into
--   the job that stays is left out, and reopening it is refused while its look-alike is open.
begin;
select plan(11);
\ir helpers/seed.sql

insert into campaigns (id, tenant_id, client_id, name, status) values
  ('aaaaaaaa-0000-0000-0000-0000000e2130', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Borderless card', 'approved');

select is((select indexdef ~ 'lower\(regexp_replace\(btrim\(name\)' from pg_indexes where indexname = 'uq_campaigns_tenant_name'),
  true, 'the rule keeps its name and reads the normalised name');
select is((select count(*)::int from pg_constraint where conname = 'uq_campaigns_tenant_name'), 0,
  'the exact-match constraint is gone');

select throws_ok($$ insert into campaigns (tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'Borderless Card') $$,
  '23505', null, 'capitals do not make a new name');
select throws_ok($$ insert into campaigns (tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', '  borderless   CARD ') $$,
  '23505', null, 'nor leading, trailing or repeated spaces');
select throws_ok($$ insert into campaigns (tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'Borderless card') $$,
  '23505', null, 'an exact repeat is still refused');
select lives_ok($$ insert into campaigns (tenant_id, client_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001', 'Borderless cards') $$,
  'a real difference is a new name (near-misses are ADR-0086''s prompt, not a refusal)');
select throws_ok($$ update campaigns set name = 'BORDERLESS CARD' where name = 'Borderless cards' $$,
  '23505', null, 'renaming into a look-alike is refused');
select lives_ok($$ insert into campaigns (tenant_id, client_id, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000c001', 'borderless card') $$,
  'another tenant may use the name');

-- A folded duplicate (ADR-0134 d.21) is outside the rule — that is how the live pairs are cleared first.
update campaigns set status = 'closed', closed_at = now(), merged_into_id = 'aaaaaaaa-0000-0000-0000-0000000e2130',
                     name = 'Borderless card (old)'
 where name = 'Borderless cards';
select lives_ok($$ update campaigns set name = 'borderless Card' where name = 'Borderless card (old)' $$,
  'a closed duplicate folded into the job that stays may carry the look-alike name');
select throws_ok($$ update campaigns set status = 'approved', closed_at = null where name = 'borderless Card' $$,
  '23505', null, 'reopening it while its look-alike is open is refused');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok($$ select public.start_campaign_draft('aaaaaaaa-0000-0000-0000-00000000c001', null, 'BorderLess  Card', null) $$,
  '23505', null, 'the wizard''s draft meets the same rule');

select * from finish();
rollback;
