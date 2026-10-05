-- The audit log's entity list is data, and it is still fenced (6 Sep).
--
-- `audit_event_entities` feeds the filter on Admin -> Audit, which was a hard-coded array of
-- fourteen table names and had missed every table created since August. A view over the log is the
-- fix; a view over the log is also exactly the shape that leaks one, so the assertions here are
-- about the fence rather than about the counts.
--
-- SECURITY INVOKER is the whole claim: the view must answer as the CALLER, so `audit:view` decides
-- what comes back and a tenant cannot see another's activity through it. A `security definer` view
-- would have passed the first assertion and failed the last two silently.
begin;
select plan(7);
\ir helpers/seed.sql

-- Two tenants' worth of activity, written directly: the trigger path is covered elsewhere and what
-- matters here is what the view returns, not how the rows arrived.
reset role;
insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001',
   'update', 'campaign_briefs', gen_random_uuid(), '{}'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001',
   'insert', 'campaign_briefs', gen_random_uuid(), '{}'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001',
   'insert', 'bookings', gen_random_uuid(), '{}'),
  ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000b001',
   'delete', 'clients', gen_random_uuid(), '{}');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

-- ---------------------------------------------------------------- it answers ----
select ok(
  exists (select 1 from public.audit_event_entities where entity = 'campaign_briefs'),
  'an entity that is IN the log appears — which the hard-coded list of fourteen never did');

select is(
  (select event_count from public.audit_event_entities
    where entity = 'campaign_briefs' and tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2, 'and it carries how many, so the filter can say whether it is worth opening');

-- An entity with no events must be ABSENT rather than present with a zero. A list of every table
-- that could theoretically appear is the hard-coded array again, one layer down.
select is_empty($$
  select 1 from public.audit_event_entities where entity = 'workflow_templates'
$$, 'an entity with no events is not offered at all');

-- ---------------------------------------------------------------- and it is fenced ----
select is_empty($$
  select 1 from public.audit_event_entities
   where tenant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
$$, 'another tenant''s activity is invisible through the view');

-- a003 holds no `audit:view`. The view is SECURITY INVOKER, so the base table's policy applies to
-- them exactly as it does to a direct select — and a definer view would quietly hand over the lot.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select ok(not app.has_permission('audit', 'view'),
  'fixture check: this caller genuinely lacks audit:view');

select is_empty($$
  select 1 from public.audit_event_entities
$$, 'without audit:view the view returns nothing — SECURITY INVOKER, not DEFINER');

-- ---------------------------------------------------------------- and nothing escapes it ----
-- THE STANDING RULE (Edward, 6 Sep): *"all actions require full audit logging."*
--
-- `20260802103000` attached the trigger to a hand-written array of 22 tables, correct on the day and
-- wrong from the next table onwards — seventeen tenant-scoped tables were created afterwards and not
-- one was added. Nothing failed. This is what fails now: a table that carries `tenant_id` and does
-- not log is named here, at build time, by name.
--
-- The exemptions are short and each has to be argued for:
--   audit_events, sla_events   they ARE the logs (append-only; auditing a log is a loop)
--   notifications, messages    content the system generates or a person types, already durable
--                              rows and already the record; a trigger would double every write
--
-- `task_time_entries` was on this list for a day and should not have been: it carries the trigger
-- and has 127 events in the live log. An exemption for a table that is audited anyway is a
-- statement nobody can act on, so it is gone and the assertion is stricter for it.
reset role;
select is_empty($$
  select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind = 'r'
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = c.oid and not a.attisdropped
          and a.attname in ('tenant_id', 'host_tenant_id'))
     and c.relname not in ('audit_events', 'sla_events', 'notifications', 'messages')
     and not exists (
       select 1 from pg_trigger tg
        where tg.tgrelid = c.oid and tg.tgname = 'audit_row_change' and not tg.tgisinternal)
$$, 'every tenant-scoped table logs to audit_events — the standing rule, enforced not remembered');

select * from finish();
rollback;
