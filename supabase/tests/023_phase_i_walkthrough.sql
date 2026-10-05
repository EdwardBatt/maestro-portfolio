-- I6.1 — Phase-I end-to-end walkthrough in one tenant (ADR-0024 exit criterion).
--
-- Drives the whole internal delivery loop as the REAL role-scoped users (RLS + the transition guard
-- + the notification emission triggers all fire on auth.uid()), and proves chat + notifications fire
-- at each step:
--   brief/setup → assign sub-tasks → in_review → internal review round (media + anchored feedback)
--   → changes-requested (revision++) → re-review → internal sign-off → delivered.
--
-- Cast: a001 = Power Admin (reviews:moderate → sign-off + moderation; also the campaign's AM here),
--       a002 = Scheduler (projects/tasks/media:manage → runs the work), a003 = Team Member (assignee).
-- Recipient-scoped notifications mean each user sees only their own inbox; the actor is always excluded.
begin;
select plan(25);
\ir helpers/seed.sql

-- ---- setup (superuser): a stream + deliverable under the seeded campaign; a001 is the AM ----
update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a001'
  where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000053d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','Social');
insert into deliverables (id, tenant_id, stream_id, name, state, revision_round, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000053e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053d1','Hero KV','draft',0, '00000000-0000-0000-0000-00000000a001');

set local role authenticated;

-- ---- a002 runs the work ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ insert into sub_tasks (id, tenant_id, deliverable_id, assignee_id, title, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000053a1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053e1','00000000-0000-0000-0000-00000000a003','Retouch', 8),
  ('aaaaaaaa-0000-0000-0000-0000000053a2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053e1','00000000-0000-0000-0000-00000000a003','Copy', 8) $$,
  'a002 assigns two sub-tasks to a003 (fires two assignment notifications)');
select lives_ok($$ update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'draft → in_progress (no notification type mapped)');
-- both sub-tasks submitted so the deliverable can enter review (ADR-0030 gate)
-- ADR-0106 d.4 (I59.20): review is reached only through app.sub_task_submit; this fixture stands in
-- for it, so it raises the flag that function raises (as test_accept_campaign_work does for its fence).
select set_config('app.submitting', 'on', true);
update sub_tasks set status='review' where deliverable_id='aaaaaaaa-0000-0000-0000-0000000053e1';
select set_config('app.submitting', '', true);
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'in_progress → in_review (fires review_requested to assignee + AM)');
select lives_ok($$ insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000053f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053e1','k/v1.png','image/png') $$,
  'a002 (media:manage) uploads version v1');

-- ADR-0038: sign-off is a rollup — every task must be APPROVED first, by its own reviewer (a001,
-- inherited from the deliverable). Approving here keeps the next assertion about AUTHORITY rather
-- than about readiness.
--
-- ADR-0058 d.6 (28 Aug) changed the shape of this setup, and the reason is worth keeping. Approving
-- the LAST task now carries its deliverable to `approved` automatically, for campaign work as well
-- as ad-hoc. So approving both through the RPC would leave nothing for a002 to be refused: the
-- deliverable would already be `approved`, a002's update would be a no-op state change, and
-- `throws_ok` would fail having proved nothing about authority.
--
-- So the FIRST task goes through the real path (proving it works and that one approval does not
-- carry a deliverable holding two), and the SECOND is settled as superuser — which fires no
-- trigger, so the deliverable genuinely stays `in_review` and a002 meets the authority gate this
-- assertion is about. The assertion is unchanged; only the road to it is.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000053a1') $$,
  'a001 (the appointed reviewer) approves the first task');
select is((select state::text from deliverables where id='aaaaaaaa-0000-0000-0000-0000000053e1'),
  'in_review',
  'one approval does not carry a deliverable that holds two — ADR-0058 d.6 waits for the last');

-- `reset role` alone is not enough: `request.jwt.claims` persists in the session, so `auth.uid()`
-- still resolves and `app.tg_sub_task_completion_guard` treats this as a person marking their own
-- work done. Clearing the claims is what makes it a system write, which is the escape that guard
-- already grants to migrations and seeders.
reset role;
select set_config('request.jwt.claims', '', true);
update sub_tasks set status='done' where id='aaaaaaaa-0000-0000-0000-0000000053a2';
set local role authenticated;
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);

-- a002 cannot sign off — no reviews:moderate (authority gate is the DB guard)
select throws_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  '42501', null, 'a002 cannot sign off (lacks reviews:moderate)');

-- ---- a003 (assignee/author) leaves an anchored review comment ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id, pos_x, pos_y) values
  ('aaaaaaaa-0000-0000-0000-0000000053b1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053f1','tighten the crop','00000000-0000-0000-0000-00000000a003',0.5,0.25) $$,
  'a003 adds an anchored comment on v1');
select is((select round from review_feedback where id='aaaaaaaa-0000-0000-0000-0000000053b1'), 1,
  'feedback round stamped = revision_round(0) + 1');

-- ---- a001 (moderator) sends it back for changes, then it re-reviews and is signed off ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ update deliverables set state='in_progress' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'a001 requests changes (in_review → in_progress; counts a revision)');
select is((select revision_round from deliverables where id='aaaaaaaa-0000-0000-0000-0000000053e1'), 1,
  'revision_round incremented to 1');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
-- ADR-0106 d.4 (I59.20): review is reached only through app.sub_task_submit; this fixture stands in
-- for it, so it raises the flag that function raises (as test_accept_campaign_work does for its fence).
select set_config('app.submitting', 'on', true);
update sub_tasks set status='review' where deliverable_id='aaaaaaaa-0000-0000-0000-0000000053e1';
select set_config('app.submitting', '', true);
select lives_ok($$ update deliverables set state='in_review' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'a002 re-submits for review (round 2 review_requested)');
-- round 2 must be approved task-by-task too, before the deliverable can be signed off.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000053a1');
                   select public.sub_task_approve('aaaaaaaa-0000-0000-0000-0000000053a2') $$,
  'a001 approves both tasks again after the rework');

select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ update deliverables set state='approved' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'a001 signs off (in_review → approved; reviews:moderate)');
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select lives_ok($$ update deliverables set state='delivered' where id='aaaaaaaa-0000-0000-0000-0000000053e1' $$,
  'a002 marks delivered (approved → delivered)');
select is((select state from deliverables where id='aaaaaaaa-0000-0000-0000-0000000053e1'), 'delivered',
  'deliverable reaches the terminal delivered state');

-- ---- notifications landed for the right people (recipient-scoped; actor excluded each step) ----
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from notifications where type='assigned'), 2, 'a003: two assignment notifications');
select is((select count(*)::int from notifications where type='review_requested'), 2, 'a003: two review-requested (initial + re-review)');
select is((select count(*)::int from notifications where type='changes_requested'), 1, 'a003: one changes-requested');
-- ADR-0038: the maker is told each time one of THEIR tasks is approved, not once when the whole
-- deliverable is signed off — two tasks over two rounds, plus the deliverable's own sign-off.
select ok((select count(*)::int from notifications where type='signed_off') >= 2,
  'a003: signed-off arrives per approved task, not once per deliverable');
select ok((select count(*)::int from notifications) > 5,
  'a003: the full loop is represented (assigned, review-requested, changes-requested, signed-off)');

-- a001 is the AM: gets review_requested on the two a002-driven submissions; excluded when it acted
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select ok((select count(*)::int from notifications where type='review_requested') >= 2,
  'a001 (AM): review-requested on each submission');
select is((select count(*)::int from notifications where actor_id = '00000000-0000-0000-0000-00000000a001'), 0,
  'a001: never notified of an action it took itself — the property this asserted all along');

-- ---- chat is wired to this deliverable: service-role creates the thread (as the chat fn does) ----
reset role;  -- superuser = the service-role path (RLS-bypassing), exactly like the chat Edge Function
insert into conversations (id, tenant_id, kind, context_type, context_id, created_by) values
  ('aaaaaaaa-0000-0000-0000-0000000053cc','aaaaaaaa-0000-0000-0000-000000000001','group','deliverable','aaaaaaaa-0000-0000-0000-0000000053e1','00000000-0000-0000-0000-00000000a002');
insert into conversation_members (conversation_id, tenant_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000053cc','aaaaaaaa-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000a003');
insert into messages (id, tenant_id, conversation_id, sender_id, body) values
  ('aaaaaaaa-0000-0000-0000-0000000053dd','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000053cc','00000000-0000-0000-0000-00000000a002','ready for your eyes');

set local role authenticated;
-- a003 is a member → reads the thread
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select is((select count(*)::int from messages where conversation_id='aaaaaaaa-0000-0000-0000-0000000053cc'), 1,
  'a003 (conversation member) reads the deliverable thread');
-- a002 was not added as a member → membership-gated read returns nothing
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
select is((select count(*)::int from messages where conversation_id='aaaaaaaa-0000-0000-0000-0000000053cc'), 0,
  'a002 (non-member) cannot read the thread (membership-gated)');

select * from finish();
rollback;
