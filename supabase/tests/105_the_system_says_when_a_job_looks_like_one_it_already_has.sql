-- I44 (ADR-0086 d.2/d.3) — `similar_open_jobs` finds this client's OPEN jobs with a similar title,
-- shows the score, and never looks across clients or tenants.
--
-- The refusals are the point. A finished job is not offered; another client's job with the same
-- title is not offered; another tenant's client id returns NOTHING, not an error that says the
-- client exists; and the job being approved does not find itself. The one positive case checks
-- the columns the modal renders: score, kind, departments, count, who raised it, when the clock
-- started (the earliest CONFIRMED receipt, never the row's creation), and status.
begin;
select plan(14);
\ir helpers/seed.sql

select has_extension('pg_trgm', 'pg_trgm is enabled (d.3)');

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative');
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

-- A second client in tenant A, and a client in tenant B, each with the SAME title as the open job.
insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000c002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other Client');

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  -- OPEN: the one the check should find.
  ('aaaaaaaa-0000-0000-0000-0000000e9201', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a001'),
  -- FINISHED: same subject, every deliverable archived.
  ('aaaaaaaa-0000-0000-0000-0000000e9202', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser post', 'approved', 'single_job', null),
  -- OPEN but unrelated.
  ('aaaaaaaa-0000-0000-0000-0000000e9203', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Annual report photography', 'approved', 'campaign', null),
  -- OPEN, same title, OTHER CLIENT.
  ('aaaaaaaa-0000-0000-0000-0000000e9204', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c002', 'Ramadan teaser posts (other client)', 'approved', 'single_job', null),
  -- The DRAFT being approved: itself a 100% match.
  ('aaaaaaaa-0000-0000-0000-0000000e9205', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3', 'pending_approval', 'single_job', null),
  -- Tenant B, same title.
  ('bbbbbbbb-0000-0000-0000-0000000e9201', 'bbbbbbbb-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-00000000c001', 'Ramadan teaser posts', 'approved', 'single_job', null);

insert into streams (id, tenant_id, campaign_id, name)
select c.id::uuid, c.tenant_id, c.id::uuid, c.name
  from campaigns c where c.id::text like '%e920%';

insert into deliverables (tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9201', 'Teaser statics', 'in_progress',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9201', 'Teaser copy', 'draft',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9202', 'Old statics', 'archived',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9203', 'Photography', 'in_progress',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9204', 'Other statics', 'in_progress',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9205', 'New statics', 'draft',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-0000000e9201', 'B statics', 'in_progress',
   null, '00000000-0000-0000-0000-00000000b001');

-- The open job's clock: a confirmed receipt from 4 Sep, made well after the row (created now).
-- The stamp trigger takes confirmed_by from auth.uid(), so the claims are set first — still as
-- superuser, so RLS is not in play for the fixture.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into campaign_brief_receipts (tenant_id, campaign_id, subject, received_at, received_tz, confirmed_at, confirmed_by) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000e9201',
   'Ramadan teaser', '2026-09-04 09:15+03', 'Asia/Baghdad', now(), '00000000-0000-0000-0000-00000000a001');

-- ---------------------------------------------------------------- the check ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);

select results_eq($$
  select campaign_id from public.similar_open_jobs(
    'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
    'aaaaaaaa-0000-0000-0000-0000000e9205')
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000e9201'::uuid) $$,
  'exactly one job is offered: the OPEN one for THIS client — not the finished one, not the other client''s, not itself');

select cmp_ok(
  (select score from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  '>=', 0.4::numeric, 'the score is shown and clears the 0.4 threshold (d.3)');

select is(
  (select kind from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  'single_job', 'the match says what kind of job it is');

select is(
  (select department_names from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  array['Creative']::text[], 'and which departments hold its live work');

select is(
  (select deliverable_count from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  2, 'and how many live deliverables it has');

select is(
  (select raised_by from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  'Admin A', 'and who raised it — the account manager');

select is(
  (select raised_at from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  '2026-09-04 09:15+03'::timestamptz,
  'and when — the earliest CONFIRMED receipt, never when the row was made (ADR-0066 d.5)');

select is(
  (select status from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3',
     'aaaaaaaa-0000-0000-0000-0000000e9205')),
  'approved', 'and where it is');

-- Without the exclusion the draft finds itself, which is why the parameter exists.
select is(
  (select count(*)::int from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3')),
  2, 'without p_exclude_campaign the job being approved is a match for itself');

select is(
  (select count(*)::int from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Quarterly investor deck')),
  0, 'an unrelated title matches nothing — it warns, it never refuses (d.4)');

-- The finished job would be a 92% match. It is not a duplicate risk.
select is(
  (select count(*)::int from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser post')
    where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9202'),
  0, 'a job whose every deliverable is archived is not open, however similar (d.2)');

-- ---------------------------------------------------------------- the fences ----
-- Tenant B, asking about tenant A's client: nothing — not an error that confirms the client exists.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is(
  (select count(*)::int from public.similar_open_jobs(
     'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts')),
  0, 'tenant B sees NONE of tenant A''s similar jobs (RLS + the explicit tenant fence)');

-- And B's own job is B's.
select is(
  (select count(*)::int from public.similar_open_jobs(
     'bbbbbbbb-0000-0000-0000-00000000c001', 'Ramadan teaser posts')),
  1, 'tenant B sees its own');

select * from finish();
rollback;
