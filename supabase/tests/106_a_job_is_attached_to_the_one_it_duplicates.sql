-- I44 (ADR-0086 d.5–d.7) — "add as a deliverable on that job" moves the draft's work onto the
-- existing job in one transaction, keeps ONE evidence trail with the clock on the original
-- start, and discards the draft.
--
-- Two scenarios and six refusals.
--
--   SAME DEPARTMENT (the common case: two Creative jobs). The deliverable moves onto the target's
--   stream; the brief cannot move (one brief per department per campaign) so its values are
--   folded into the target's; the receipt joins the target's trail BEHIND the original, and the
--   clock's origin — the earliest confirmed receipt — does not move; the files land in the
--   target's matching folders; the draft is gone; the owner is told ONCE.
--
--   DIFFERENT DEPARTMENT (a Production job attached to a Creative job). The brief moves whole;
--   the new deliverable's owner is told it is theirs (Action 15); the existing owner, whose own
--   work did not change, is not (I53.18, 21 Sep).
--
--   REFUSED: a different client (22023); a released job as the draft (22023); a campaign as the
--   draft (22023); itself (22023); an account manager out of scope for one of the two (42501);
--   another tenant (P0002).
--
-- Notifications are asserted after `reset role` (traps.md). Everything else runs as the caller.
begin;
select plan(32);
\ir helpers/seed.sql
-- ADR-0134 d.1 (I72): reading the Library needs assets:view, which every internal role holds in
-- production (app.seed_tenant_asset_grants); the base fixture seeds roles only.
select app.seed_tenant_asset_grants(id) from tenants;

-- ---------------------------------------------------------------- fixtures ----
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000de001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative'),
  ('aaaaaaaa-0000-0000-0000-0000000de002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Production');

-- a003: Creative lead. a013: Production lead. a010: the account manager of every job here.
-- a011: an account manager of NONE of them.
update user_profiles
   set role_id = (select id from roles where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
                    and key = 'department_lead'),
       department_id = 'aaaaaaaa-0000-0000-0000-0000000de001'
 where id = '00000000-0000-0000-0000-00000000a003';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a010', 'am-one@a.test'),
  ('00000000-0000-0000-0000-00000000a011', 'am-two@a.test'),
  ('00000000-0000-0000-0000-00000000a013', 'prod-lead@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r
         where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a010', 'AM One',    'account_manager', null),
  ('00000000-0000-0000-0000-00000000a011', 'AM Two',    'account_manager', null),
  ('00000000-0000-0000-0000-00000000a013', 'Prod Lead', 'department_lead', 'aaaaaaaa-0000-0000-0000-0000000de002')
) as v(id, name, role_key, dept);
insert into test_claims
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up
 where up.id in ('00000000-0000-0000-0000-00000000a010', '00000000-0000-0000-0000-00000000a011',
                 '00000000-0000-0000-0000-00000000a013');

insert into clients (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000c002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Other Client');

-- Campaign rows. Folders are provisioned by the insert trigger.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  -- Scenario 1: target T1 and draft X1, both Creative.
  ('aaaaaaaa-0000-0000-0000-0000000e9301', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Ramadan teaser posts x3', 'pending_approval', 'single_job',
   '00000000-0000-0000-0000-00000000a010'),
  -- Scenario 2: target T2 (a campaign, Creative work) and draft X2 (Production).
  ('aaaaaaaa-0000-0000-0000-0000000e9303', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Eid campaign', 'approved', 'campaign',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000e9304', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Eid campaign print run', 'pending_approval', 'single_job',
   '00000000-0000-0000-0000-00000000a010'),
  -- Refusals: another client's draft; a released single job; a campaign-kind draft.
  ('aaaaaaaa-0000-0000-0000-0000000e9305', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c002', 'Other client job', 'pending_approval', 'single_job',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000e9306', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'Released job', 'approved', 'single_job',
   '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000e9307', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001', 'A campaign draft', 'pending_approval', 'campaign',
   '00000000-0000-0000-0000-00000000a010');

insert into streams (id, tenant_id, campaign_id, name)
select c.id, c.tenant_id, c.id, c.name from campaigns c where c.id::text like '%e930%';

insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d9301', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9301', 'Teaser statics', 'in_progress',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d9302', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9302', 'Teaser statics x3', 'draft',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d9303', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9303', 'Eid KV', 'in_progress',
   '00000000-0000-0000-0000-00000000a003', '00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000d9304', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9304', 'Eid print run', 'draft',
   '00000000-0000-0000-0000-00000000a013', '00000000-0000-0000-0000-00000000a001');

-- A task under the draft's deliverable, to prove it travels with it.
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, sort_order) values
  ('aaaaaaaa-0000-0000-0000-0000000f9301', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000d9302', 'Create Artwork', 'todo', 1);

insert into campaign_briefs (id, tenant_id, campaign_id, department_id, brief_type, values, approved_at, approved_by) values
  ('aaaaaaaa-0000-0000-0000-0000000cb931', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9301', 'aaaaaaaa-0000-0000-0000-0000000de001', 'single_execution',
   '{"task":"Existing task","specs":""}', now(), '00000000-0000-0000-0000-00000000a010'),
  ('aaaaaaaa-0000-0000-0000-0000000cb932', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000de001', 'single_execution',
   '{"task":"New task","specs":"1080x1080","copy":""}', null, null),
  ('aaaaaaaa-0000-0000-0000-0000000cb933', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9303', 'aaaaaaaa-0000-0000-0000-0000000de001', 'creative',
   '{}', now(), '00000000-0000-0000-0000-00000000a003'),
  ('aaaaaaaa-0000-0000-0000-0000000cb934', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9304', 'aaaaaaaa-0000-0000-0000-0000000de002', 'single_execution',
   '{"task":"Print 500"}', null, null);

-- A file in the draft's References folder, and a custom sub-folder beside it.
insert into assets (id, tenant_id, folder_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000a5931', 'aaaaaaaa-0000-0000-0000-000000000001',
   (select id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9302' and name = 'References'),
   'whatsapp-10-sep.png');

-- Receipts: confirmed by a001 (the stamp trigger reads auth.uid(), so claims are set first, still
-- as superuser). The target's arrived on 4 Sep, the draft's on 10 Sep, with the screenshot above.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
insert into campaign_brief_receipts (id, tenant_id, campaign_id, asset_id, subject, received_at, received_tz, confirmed_at) values
  ('aaaaaaaa-0000-0000-0000-0000000fa931', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9301', null, 'Ramadan teaser', '2026-09-04 09:15+03', 'Asia/Baghdad', now()),
  ('aaaaaaaa-0000-0000-0000-0000000fa932', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000a5931', 'Three more teasers',
   '2026-09-10 16:40+03', 'Asia/Baghdad', now());
select set_config('request.jwt.claims', '', true);

insert into asset_folders (id, tenant_id, client_id, parent_id, name, kind, campaign_id) values
  ('aaaaaaaa-0000-0000-0000-0000000af931', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000c001',
   (select id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9302' and name = 'References'),
   'Client links', 'custom', 'aaaaaaaa-0000-0000-0000-0000000e9302');

-- ---------------------------------------------------------------- refusals ----
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);

select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9305', 'aaaaaaaa-0000-0000-0000-0000000e9301')
$$, '22023', null, 'a job for ANOTHER CLIENT cannot be attached — never across clients (d.2)');

select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9306', 'aaaaaaaa-0000-0000-0000-0000000e9301')
$$, '22023', null, 'a RELEASED job is not a draft and cannot be attached');

select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9307', 'aaaaaaaa-0000-0000-0000-0000000e9301')
$$, '22023', null, 'a CAMPAIGN cannot be attached to a job — only a single job can');

select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000e9302')
$$, '22023', null, 'a job cannot be attached to itself');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a011'), true);
select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000e9301')
$$, '42501', null, 'an account manager out of scope for the jobs is refused (ADR-0073)');

select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select throws_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000e9301')
$$, 'P0002', null, 'tenant B cannot reach tenant A''s jobs — not found');

-- ---------------------------------------------------------------- scenario 1: same department ----
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a010'), true);

select is(
  public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9302', 'aaaaaaaa-0000-0000-0000-0000000e9301'),
  'aaaaaaaa-0000-0000-0000-0000000e9301'::uuid,
  'the account manager attaches the draft to the existing job and gets the target back');

select is(
  (select count(*)::int from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000e9302'),
  0, 'the draft campaign is gone (d.5)');

select is(
  (select stream_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9302'),
  'aaaaaaaa-0000-0000-0000-0000000e9301'::uuid,
  'the deliverable sits on the target''s EXISTING stream — a campaign has one stream, named for it');
select is(
  (select count(*)::int from streams where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9301'),
  1, 'and the target still has exactly one stream');
select is(
  (select owner_user_id from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d9302'),
  '00000000-0000-0000-0000-00000000a003'::uuid,
  'the deliverable keeps its own owner (d.5)');
select is(
  (select deliverable_id from sub_tasks where id = 'aaaaaaaa-0000-0000-0000-0000000f9301'),
  'aaaaaaaa-0000-0000-0000-0000000d9302'::uuid,
  'and its tasks travel with it');

-- The brief: one per department per campaign, so the draft's values are folded into the target's.
select is(
  (select count(*)::int from campaign_briefs where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9301'),
  1, 'the target still has ONE Creative brief');
select is(
  (select values ->> 'task' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb931'),
  E'Existing task\n\n— Ramadan teaser posts x3 —\nNew task',
  'a field both briefs filled carries both, the attached job''s under a heading naming it — nothing is lost');
select is(
  (select values ->> 'specs' from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb931'),
  '1080x1080',
  'a field only the draft filled is simply taken');
select isnt(
  (select approved_at from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb931'),
  null, 'the target brief''s approval stands — resetting it would freeze the target''s existing work');

-- The receipts: ONE trail, in arrival order, the clock on the original start (d.5/d.6).
select results_eq($$
  select id from campaign_brief_receipts
   where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9301'
   order by received_at
$$, $$ values ('aaaaaaaa-0000-0000-0000-0000000fa931'::uuid), ('aaaaaaaa-0000-0000-0000-0000000fa932'::uuid) $$,
  'both receipts sit on the target, in arrival order: the original first, the attached one behind it (d.5)');
select is(
  (select min(received_at) from campaign_brief_receipts
    where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9301' and confirmed_at is not null),
  '2026-09-04 09:15+03'::timestamptz,
  'the clock does not restart — the earliest confirmed receipt is still 4 Sep (d.6)');
select is(
  (select confirmed_by from campaign_brief_receipts where id = 'aaaaaaaa-0000-0000-0000-0000000fa932'),
  '00000000-0000-0000-0000-00000000a001'::uuid,
  'moving a receipt is not editing it — whoever confirmed it still does');

-- The files.
select is(
  (select f.campaign_id from assets a join asset_folders f on f.id = a.folder_id
    where a.id = 'aaaaaaaa-0000-0000-0000-0000000a5931'),
  'aaaaaaaa-0000-0000-0000-0000000e9301'::uuid,
  'the evidence screenshot now lives in the TARGET''s folders');
select is(
  (select f.name from assets a join asset_folders f on f.id = a.folder_id
    where a.id = 'aaaaaaaa-0000-0000-0000-0000000a5931'),
  'References', 'in its References folder, where it was');
select is(
  (select parent_id from asset_folders where id = 'aaaaaaaa-0000-0000-0000-0000000af931'),
  (select id from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9301' and name = 'References'),
  'a custom sub-folder moves under the target''s matching folder');
select is(
  (select count(*)::int from asset_folders where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9302'),
  0, 'and nothing is left under the draft');

-- ---------------------------------------------------------------- scenario 2: different department ----
select lives_ok($$
  select public.attach_job_to_campaign('aaaaaaaa-0000-0000-0000-0000000e9304', 'aaaaaaaa-0000-0000-0000-0000000e9303')
$$, 'a Production job is attached to a Creative campaign');

select is(
  (select campaign_id from campaign_briefs where id = 'aaaaaaaa-0000-0000-0000-0000000cb934'),
  'aaaaaaaa-0000-0000-0000-0000000e9303'::uuid,
  'a brief for a department NEW to the target moves whole');
select is(
  (select count(*)::int from campaign_briefs where campaign_id = 'aaaaaaaa-0000-0000-0000-0000000e9303'),
  2, 'the target now has two department briefs — a job may hold work for two departments (d.5)');

-- ---------------------------------------------------------------- who was told (d.7) ----
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from notifications
    where type = 'deliverable_added' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9302'
      and user_id = '00000000-0000-0000-0000-00000000a003'),
  1, 'scenario 1: the existing owner is told ONCE that a deliverable was added');
select is(
  (select count(*)::int from notifications
    where user_id = '00000000-0000-0000-0000-00000000a003'
      and entity_id in ('aaaaaaaa-0000-0000-0000-0000000d9302', 'aaaaaaaa-0000-0000-0000-0000000e9301')),
  1, 'and NOT a second time as the attached deliverable''s owner — one event, one notice');
-- I53.18 (Edward, 21 Sep): the one-line notice to the OTHER owners on the job is gone — "existing
-- owners should only be notified of changes to their existing deliverables".
select is(
  (select count(*)::int from notifications
    where type = 'deliverable_added' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9304'
      and user_id = '00000000-0000-0000-0000-00000000a003'),
  0, 'scenario 2: the Creative owner, whose own deliverable did not change, is NOT told (I53.18)');
-- I52 Action 15 (17 Sep): the NEW deliverable's owner is told first, as the owner — what arrived is
-- theirs to brief and task — instead of the release notice this used to send.
select is(
  (select count(*)::int from notifications
    where type = 'deliverable_added' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d9304'
      and user_id = '00000000-0000-0000-0000-00000000a013'
      and (detail ->> 'for_owner') = 'true'),
  1, 'and the Production owner — the new deliverable''s own owner — is told it is theirs to review and approve (I52 Action 15)');
select is(
  (select count(*)::int from notifications
    where type = 'campaign_approved' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000e9303'
      and user_id = '00000000-0000-0000-0000-00000000a013'),
  0, 'and no separate release notice — one event, one notice');
select is(
  (select count(*)::int from notifications where user_id = '00000000-0000-0000-0000-00000000a010'),
  0, 'the account manager is never told about their own act');

select * from finish();
rollback;
