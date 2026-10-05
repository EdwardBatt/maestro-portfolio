-- Append-only guarantees (§5.5): SLA/audit events can be written, never
-- rewritten — by anyone, including their author.
begin;
select plan(6);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- Creative flags "blocked on client" → an attributable event (OD 5 leaning:
-- self-service to log, visible claim).
select lives_ok($$
  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000f101',
          'blocked_flagged', 'client',
          '00000000-0000-0000-0000-00000000a003',
          '{"note":"awaiting client assets"}')
$$, 'creative can log a blocked-on-client claim');

-- Actor spoofing rejected: actor_user_id must be the caller.
select throws_ok($$
  insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-00000000f101',
          'clock_paused',
          '00000000-0000-0000-0000-00000000a001')
$$, '42501', null, 'cannot log events as someone else');

-- Immutable: UPDATE and DELETE fail even for the author (grant revoked).
select throws_ok(
  $$ update sla_events set payload = '{}' $$,
  '42501', null, 'sla_events update denied — append-only');
select throws_ok(
  $$ delete from sla_events $$,
  '42501', null, 'sla_events delete denied — append-only');

-- Events without a subject are rejected.
select throws_ok($$
  insert into sla_events (tenant_id, event_type, actor_user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'clock_paused',
          '00000000-0000-0000-0000-00000000a003')
$$, '23514', null, 'event must reference a deliverable, job or booking');

-- Audit events equally immutable.
select throws_ok(
  $$ update audit_events set payload = '{}' $$,
  '42501', null, 'audit_events update denied — append-only');

select * from finish();
rollback;
