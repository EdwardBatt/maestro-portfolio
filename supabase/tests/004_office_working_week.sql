-- ADR-0005: per-office working week shape.
begin;
select plan(5);
\ir helpers/seed.sql

-- Default applies (Mon–Fri) when unspecified.
insert into offices (id, tenant_id, name, timezone)
values ('aaaaaaaa-0000-0000-0000-00000000aa01', 'aaaaaaaa-0000-0000-0000-000000000001', 'Dubai', 'Asia/Dubai');
select is(
  (select working_days from offices where id = 'aaaaaaaa-0000-0000-0000-00000000aa01'),
  '{1,2,3,4,5}'::smallint[], 'default working week is Mon–Fri');

-- Sun–Thu (Baghdad/Cairo shape) is storable.
insert into offices (id, tenant_id, name, timezone, working_days)
values ('aaaaaaaa-0000-0000-0000-00000000aa02', 'aaaaaaaa-0000-0000-0000-000000000001', 'Baghdad', 'Asia/Baghdad', '{7,1,2,3,4}');
select is(
  (select working_days from offices where id = 'aaaaaaaa-0000-0000-0000-00000000aa02'),
  '{7,1,2,3,4}'::smallint[], 'Sun–Thu week stored');

-- Invalid weekday number rejected.
select throws_ok($$
  insert into offices (tenant_id, name, timezone, working_days)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Bad', 'Asia/Baghdad', '{0,1,2}')
$$, '23514', null, 'weekday 0 rejected (ISO is 1..7)');

-- Empty working week rejected.
select throws_ok($$
  insert into offices (tenant_id, name, timezone, working_days)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'Never', 'Asia/Baghdad', '{}')
$$, '23514', null, 'empty working week rejected');

-- Tenant isolation still holds on the new column path.
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b002'), true);
select is((select count(*)::int from offices where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0,
  'B cannot read A offices (incl. working_days)');

select * from finish();
rollback;
