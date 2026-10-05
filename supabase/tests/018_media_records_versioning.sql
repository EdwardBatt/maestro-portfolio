-- ADR-0025 (I3.1): media_records version stamping + grant-driven write RLS.
-- Proves: version is server-stamped monotonically per deliverable; writes require the
-- `media:manage` grant (retiring the old jwt_role policy); cross-tenant writes are blocked;
-- reads stay tenant-wide.
begin;
select plan(7);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000031d1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','Rev Stream');
insert into deliverables (id, tenant_id, stream_id, name, state, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000031e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000031d1','Rev Deliverable','in_progress', '00000000-0000-0000-0000-00000000a001');

set local role authenticated;

-- Scheduler holds media:manage (tenant scope) — two uploads stamp version 1 then 2.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into media_records (tenant_id, deliverable_id, object_key, content_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000031e1','k/v-a.png','image/png') $$,
  'media:manage holder uploads a first version');
select is((select version from media_records where object_key='k/v-a.png'), 1, 'first version stamped 1');
select lives_ok($$ insert into media_records (tenant_id, deliverable_id, object_key, content_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000031e1','k/v-b.png','image/png') $$,
  'second upload on the same deliverable');
select is((select version from media_records where object_key='k/v-b.png'), 2, 'second version stamped 2 (monotonic per deliverable)');

-- media:manage is required: strip it from team_member, then a003 is denied (WITH CHECK → 42501).
set local role postgres;
delete from role_grants
 where tenant_id='aaaaaaaa-0000-0000-0000-000000000001'
   and role_id=(select id from roles where tenant_id='aaaaaaaa-0000-0000-0000-000000000001' and key='team_member')
   and resource='media' and action='manage';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select throws_ok($$ insert into media_records (tenant_id, deliverable_id, object_key, content_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000031e1','k/hack.png','image/png') $$,
  '42501', null, 'write without media:manage is denied');

-- Cross-tenant: tenant B cannot write onto tenant A's deliverable.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select throws_ok($$ insert into media_records (tenant_id, deliverable_id, object_key, content_type)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000031e1','k/x.png','image/png') $$,
  '42501', null, 'cross-tenant media write is denied');

-- Reads stay tenant-wide: the (now media-less) member still sees both versions.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from media_records where deliverable_id='aaaaaaaa-0000-0000-0000-0000000031e1'),
  2, 'reads are tenant-wide (member sees both versions)');

select * from finish();
rollback;
