-- 20260930110000 (I67.2) — a change to tasks or bookings nudges the tenant's private work topic, once per statement,
-- and only that tenant's active members may receive it.
--
-- `realtime.*` exists on Supabase (the local stack included) but not in the CI harness. Where it is absent, this suite
-- stands up a stand-in `realtime.send` that records what it is given, inside this transaction, so the trigger is
-- proved in CI too. The receive policy exists only where realtime does, so its two checks are skipped in CI and run
-- on the local stack (`supabase test db`).
begin;
select plan(10);
\ir helpers/seed.sql

do $$
begin
  if to_regprocedure('realtime.send(jsonb, text, text, boolean)') is null then
    create schema if not exists realtime;
    create table realtime.messages (
      topic text, event text, payload jsonb, extension text default 'broadcast', private boolean,
      inserted_at timestamptz default now()
    );
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void language sql as $f$
      insert into realtime.messages (topic, event, payload, private) values (topic, event, payload, private)
    $f$;
  end if;
end $$;

create temp view work_nudges with (security_invoker = true) as
  select topic, payload - 'id' as payload from realtime.messages  -- Supabase's send adds an "id" to the payload
   where event = 'work_changed' and inserted_at >= now() and topic like 'tenant:%:work';
grant select on work_nudges to authenticated;

select ok((select prosecdef and proconfig::text like '%search_path=%' from pg_proc
            where oid = 'app.tg_work_changed_broadcast()'::regprocedure),
  'the sender runs as its owner (clients have no INSERT on realtime.messages) with search_path pinned');
select is((select count(*)::int from pg_trigger
            where tgname ~ '^(sub_tasks|bookings)_work_changed_(ins|upd|del)$' and not tgisinternal), 6,
  'three statement triggers on each of sub_tasks and bookings');

-- one statement inserting two tasks → one nudge
insert into sub_tasks (id, tenant_id, deliverable_id, title, status) values
  ('aaaaaaaa-0000-0000-0000-0000000201f1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'One', 'todo'),
  ('aaaaaaaa-0000-0000-0000-0000000201f2', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000f101', 'Two', 'todo');
select results_eq(
  $$ select topic, payload from work_nudges $$,
  $$ values ('tenant:aaaaaaaa-0000-0000-0000-000000000001:work', '{"op": "insert", "table": "sub_tasks"}'::jsonb) $$,
  'a two-row insert sends ONE nudge, on its own tenant''s topic, naming only the table and the operation');

update sub_tasks set title = title || '!' where id::text like '%0201f%';
select is((select count(*)::int from work_nudges where payload ->> 'op' = 'update'), 1, 'an update nudges once');

delete from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000201f1';
select is((select count(*)::int from work_nudges where payload ->> 'op' = 'delete'), 1, 'a delete nudges');

update sub_tasks set title = title where id = '00000000-0000-0000-0000-000000000000';
select is((select count(*)::int from work_nudges where payload ->> 'op' = 'update'), 1,
  'a statement touching no row sends nothing');

select is((select count(*)::int from work_nudges where topic like 'tenant:bbbbbbbb%'), 0,
  'tenant A''s change says nothing on tenant B''s topic');

insert into bookings (id, tenant_id, resource_id, starts_at, ends_at, state, booked_by) values
  ('aaaaaaaa-0000-0000-0000-0000000201b1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000d0a1',
   '2026-11-10 06:00:00+00', '2026-11-10 10:00:00+00', 'confirmed', '00000000-0000-0000-0000-00000000a001');
select is((select count(*)::int from work_nudges where payload ->> 'table' = 'bookings'), 1, 'a booking change nudges too');

-- Receiving: an active member of tenant A reads the topic; tenant B's admin, asking for A's topic, reads nothing.
select exists (select 1 from pg_policy where polname = 'tenant_members_receive_work_broadcast') as has_realtime \gset
\if :has_realtime
select set_config('realtime.topic', 'tenant:aaaaaaaa-0000-0000-0000-000000000001:work', true);
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select ok((select count(*) from work_nudges) > 0, 'a member of tenant A receives on tenant A''s work topic');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is((select count(*)::int from work_nudges), 0, 'tenant B''s admin cannot receive on tenant A''s topic');
reset role;
\else
select skip('realtime is absent here (CI harness) — the receive policy is checked on the local stack', 2);
\endif

select * from finish();
rollback;
