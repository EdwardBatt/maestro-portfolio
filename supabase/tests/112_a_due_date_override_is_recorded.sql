-- I41.8 (ADR-0075 d.9, amended by ADR-0093) — a date inside the two days warns and is allowed; the
-- override is recorded; a date AFTER go-live warns too, is allowed, and is recorded as such.
--
-- Properties:
--   * `due_date_override` is a legal sla_events type;
--   * the wizard path: a deliverable whose JSON carries `dueDateOverride` is created AND an
--     sla_events row is written against it, naming the severity and the arithmetic, stamped with
--     the actor;
--   * the wizard path ACCEPTS a due date after go-live and records an after_go_live override;
--   * `record_due_date_override` on an existing deliverable writes the row; 'ok' is not an override
--     and is refused; a deliverable in another tenant is not found.
begin;
select plan(10);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

-- ---------------------------------------------------------------- the wizard path ----
select lives_ok($$
  select public.start_campaign_draft('aaaaaaaa-0000-0000-0000-00000000c001', null, 'Tight 112', null)
$$, 'a draft to complete');

-- Go-live Sunday 4 Oct 2026; due Thursday 1 Oct — one working day left against two required.
-- The owner rides on the payload because ADR-0100 d.8 makes it mandatory at creation; a001 rather
-- than the seed's Creative A, who is a team member and so may not own a deliverable (ADR-0083 d.9).
-- It is not what this suite is about — it is what makes the deliverable legal enough to test.
select lives_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Tight 112'),
    '{"languages":["en"],"proposition":"p"}'::jsonb,
    '2026-10-04T00:00:00Z',
    '[{"name":"Key Visual","dueAt":"2026-10-01",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001",
       "dueDateOverride":{"severity":"tight","workingDaysLeft":1,"requiredDays":2},"workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'a tight due date is ALLOWED (d.9 — warn, never block)');

select results_eq($$
  select e.event_type, e.payload ->> 'severity', (e.payload ->> 'working_days_left')::int,
         e.payload ->> 'due_day', e.payload ->> 'go_live_day', e.actor_user_id
    from sla_events e
    join deliverables d on d.id = e.deliverable_id
   where d.name = 'Key Visual' and e.event_type = 'due_date_override'
$$, $$ values ('due_date_override'::text, 'tight'::text, 1, '2026-10-01'::text, '2026-10-04'::text,
               '00000000-0000-0000-0000-00000000a001'::uuid) $$,
  'and the override is RECORDED against the deliverable, with the arithmetic and the actor');

-- After go-live (ADR-0093): warned, allowed, and the override says what the person was shown.
select lives_ok($$
  select public.start_campaign_draft('aaaaaaaa-0000-0000-0000-00000000c001', null, 'Late 112', null)
$$, 'a second draft');
select lives_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Late 112'),
    '{"languages":["en"],"proposition":"p"}'::jsonb,
    '2026-10-04T00:00:00Z',
    '[{"name":"Banner","dueAt":"2026-10-06",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001",
       "dueDateOverride":{"severity":"after_go_live","workingDaysLeft":0,"requiredDays":2},"workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'ADR-0093: a due date AFTER go-live is accepted by the wizard');
select is(
  (select e.payload ->> 'severity' from sla_events e join deliverables d on d.id = e.deliverable_id
    where d.name = 'Banner' and e.event_type = 'due_date_override'),
  'after_go_live', 'and the override records after_go_live as the severity shown');

-- ---------------------------------------------------------------- an existing deliverable ----
select lives_ok($$
  select public.record_due_date_override(
    (select id from deliverables where name = 'Key Visual'),
    '2026-10-04', 'impossible', '2026-10-04', 0, 2, 40, 16)
$$, 'the due-date dialog records an override on an existing deliverable');
select is(
  (select count(*)::int from sla_events e join deliverables d on d.id = e.deliverable_id
    where d.name = 'Key Visual' and e.event_type = 'due_date_override'),
  2, 'two overrides now stand against it');

select throws_ok($$
  select public.record_due_date_override(
    (select id from deliverables where name = 'Key Visual'),
    '2026-09-20', 'ok', '2026-10-04', 5, 2)
$$, '23514', null, 'an "ok" date is not an override and is refused');

-- Tenant B cannot reach it.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'),true);
select throws_ok($$
  select public.record_due_date_override(
    (select id from deliverables where name = 'Key Visual'),
    '2026-10-04', 'tight', '2026-10-04', 1, 2)
$$, 'P0002', null, 'a deliverable in another tenant is not found');

select * from finish();
rollback;
