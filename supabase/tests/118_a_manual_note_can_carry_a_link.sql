-- ADR-0059 addendum d.14–d.15 (I48.29): a task-anchored note may carry one link, and the note
-- stays required.
--
-- The link is metadata on the note, never a version — so the suite proves three things and only
-- three: the CHECK holds at the database (the note is a plain insert, so a form-only rule is no
-- rule); the submit gate is UNCHANGED by the column's existence (a note without a link still
-- submits — 073's assertion, re-asserted beside a note WITH one); and the column rides the table's
-- existing tenant fence.
--
-- Subjects (helpers/seed.sql): tenant A a003 = team_member (the maker); tenant B b001 = its admin.

begin;
select plan(9);
\ir helpers/seed.sql

reset role;

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000118f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000e001','S118');
insert into deliverables (id, tenant_id, stream_id, name, state) values
  ('aaaaaaaa-0000-0000-0000-0000000118e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000118f1','Keynote, Q4 pitch','in_progress');
insert into sub_tasks (id, tenant_id, deliverable_id, title, assignee_id, status, review_mode, sla_hours) values
  ('aaaaaaaa-0000-0000-0000-0000000118a1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000118e1','Build the deck','00000000-0000-0000-0000-00000000a003','in_progress','manual', 8),
  ('aaaaaaaa-0000-0000-0000-0000000118a2','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000118e1','Proof the deck','00000000-0000-0000-0000-00000000a003','in_progress','manual', 8);
insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a1','00000000-0000-0000-0000-00000000a001', true),
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a2','00000000-0000-0000-0000-00000000a001', true);

-- ============================================ 1-4. the CHECK, at the database ====
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

select lives_ok(
  $$insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id, link_url)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a1',
            'internal','Deck v1 is on iCloud, all 14 slides.','00000000-0000-0000-0000-00000000a003',
            'https://www.icloud.com/keynote/0abc_deck#Q4_pitch')$$,
  'a note carries an https link');

select lives_ok(
  $$insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id, link_url)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a2',
            'internal','Proofed on the staging site.','00000000-0000-0000-0000-00000000a003',
            'HTTP://staging.example.test/deck')$$,
  'the scheme check is case-insensitive — http and HTTP both pass');

select throws_ok(
  $$insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id, link_url)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a2',
            'internal','on the ftp','00000000-0000-0000-0000-00000000a003',
            'ftp://files.example.test/deck.key')$$,
  '23514', null,
  'ftp:// is refused — http(s) only');

select throws_ok(
  $$insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id, link_url)
    values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a2',
            'internal','see drive','00000000-0000-0000-0000-00000000a003',
            'the shared drive, Q4 folder')$$,
  '23514', null,
  'a bare phrase is refused — a link is a URL or it is nothing');

-- ================================ 5-6. the submit gate is untouched (d.15) ====
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000118a1', 30, true)$$,
  'a manual task submits on a note WITH a link — the gate reads the note, as before');

-- The sibling's own note this round has a link too (assertion 2); a note WITHOUT one must also
-- satisfy the gate, or the column would have tightened what 073 proved. Written as a second
-- note on the same round: the gate asks for the maker's own note this round, not for its shape.
reset role;
delete from review_feedback where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000118a2';
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
insert into review_feedback (tenant_id, sub_task_id, source, body, author_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000118a2',
   'internal','Proofed; no link, it was on paper.','00000000-0000-0000-0000-00000000a003');
-- ADR-0106 (I59.20): sent in the same transaction as its Start (or never started) — an UNTIMED round, accepted as one.
select lives_ok(
  $$select app.sub_task_submit('aaaaaaaa-0000-0000-0000-0000000118a2', 30, true)$$,
  'a manual task still submits on a note WITHOUT a link — nothing was tightened');

-- ======================================= 7-8. the link is what was written ====
select is(
  (select link_url from review_feedback
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000118a1'),
  'https://www.icloud.com/keynote/0abc_deck#Q4_pitch',
  'the maker reads back the link they wrote');

select is(
  (select count(*)::int from review_feedback
    where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000118a2' and link_url is null),
  1,
  'a note with no link is null, not an empty string');

-- ================================================= 9. the tenant fence ====
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000b001'), true);
select is(
  (select count(*)::int from review_feedback where link_url is not null),
  0,
  'tenant B sees no linked note of tenant A''s — the column rides the existing fence');

select * from finish();
rollback;
