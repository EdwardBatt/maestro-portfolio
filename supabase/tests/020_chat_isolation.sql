-- ADR-0015/0027: chat spine — per-conversation seq, membership-gated reads, no direct client
-- writes (all message writes go through the service-role chat function), cross-tenant isolation.
begin;
select plan(10);
\ir helpers/seed.sql

insert into conversations (id, tenant_id, kind, context_type, context_id, title, created_by)
  values ('aaaaaaaa-0000-0000-0000-00000000c001','aaaaaaaa-0000-0000-0000-000000000001','group','group',null,'Room','00000000-0000-0000-0000-00000000a002');
insert into conversation_members (conversation_id, tenant_id, user_id)
  values ('aaaaaaaa-0000-0000-0000-00000000c001','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a002');
insert into messages (id, tenant_id, conversation_id, sender_id, body) values
  ('aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000a002','one'),
  ('aaaaaaaa-0000-0000-0000-00000000e002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000a002','two');

select is(
  (select array_agg(seq order by seq) from messages where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001')::bigint[],
  array[1, 2]::bigint[], 'seq is monotonic per conversation');
select isnt(
  (select last_message_at from conversations where id='aaaaaaaa-0000-0000-0000-00000000c001'), null,
  'last_message_at touched on insert');

set local role authenticated;

-- member (a002) sees the conversation and both messages
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select is((select count(*)::int from conversations where id='aaaaaaaa-0000-0000-0000-00000000c001'), 1, 'member sees the conversation');
select is((select count(*)::int from messages where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001'), 2, 'member sees both messages');
select lives_ok($$ update conversation_members set last_read_seq=2 where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001' and user_id='00000000-0000-0000-0000-00000000a002' $$,
  'member updates their own read cursor');
select is((select last_read_seq from conversation_members where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001'), 2::bigint, 'read cursor advanced');

-- non-member (a003) sees nothing, and cannot insert directly
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from conversations where id='aaaaaaaa-0000-0000-0000-00000000c001'), 0, 'non-member cannot see the conversation');
select is((select count(*)::int from messages where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001'), 0, 'non-member cannot see messages');
select throws_ok($$ insert into messages (id, tenant_id, conversation_id, sender_id, body)
  values ('aaaaaaaa-0000-0000-0000-00000000e003','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001','00000000-0000-0000-0000-00000000a003','hack') $$,
  '42501', null, 'clients cannot insert messages directly (writes go through the chat function)');

-- cross-tenant (b002) sees nothing
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b002'),true);
select is((select count(*)::int from messages where conversation_id='aaaaaaaa-0000-0000-0000-00000000c001'), 0, 'cross-tenant cannot see messages');

select * from finish();
rollback;
