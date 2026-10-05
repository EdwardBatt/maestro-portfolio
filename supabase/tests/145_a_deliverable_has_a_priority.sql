-- SJ-v3-04 (22 Sep) — the priority chosen on who and when lands on the deliverable row, through the
-- one content writer; a value outside High / Medium / Low is refused by the column, not by code.
begin;
select plan(5);
\ir helpers/seed.sql

set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);

select lives_ok($$
  select public.start_campaign_draft('aaaaaaaa-0000-0000-0000-00000000c001', null, 'Priority job 145', null)
$$, 'a draft starts');

-- ADR-0100 d.8: an owner is named on every deliverable a real caller creates, so the draft
-- carries one. Before that rule the wizard asked nicely and the database did not; the priority
-- this suite is about rides on a row that now cannot exist without somebody answering for it.
select lives_ok($$
  select public.complete_campaign_draft(
    (select id from campaigns where name = 'Priority job 145'),
    '{"languages":["en"]}'::jsonb, null,
    '[{"name":"Carousel","quantity":"1","dueAt":"2026-10-01T15:00:00Z","priority":"high",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001","workstreamKey":"w"},
      {"name":"Untouched","quantity":"1","dueAt":"2026-10-02T15:00:00Z",
       "ownerUserId":"00000000-0000-0000-0000-00000000a001","workstreamKey":"w"}]'::jsonb,
    p_workstreams => '[{"key":"w","name":"Main work","departmentId":"aaaaaaaa-0000-0000-0000-0000000de0ff"}]'::jsonb)
$$, 'the draft completes with a priority on one deliverable and none on the other');

select is(
  (select priority from deliverables where name = 'Carousel' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'high', 'the deliverable carries the priority the account manager chose');
select is(
  (select priority from deliverables where name = 'Untouched' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  null, 'a deliverable with no priority stays null — nothing existing changes');

reset role;
select throws_ok($$
  update deliverables set priority = 'urgent' where name = 'Carousel'
$$, '23514', null, 'the column refuses anything but high / medium / low');

select * from finish();
rollback;
