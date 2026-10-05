-- I23.3 (ADR-0057 d.6) — a comment on a PDF can name the page it is about.
--
-- `review_feedback.page` joins `pos_x`/`pos_y` and `timecode_ms` as the third anchor. It is a
-- column, not a feature, so what is worth asserting is narrow and specific: it stores what the
-- reviewer meant, it refuses a page number that cannot exist, it is optional for every format, and
-- it inherits the tenant fence rather than opening a way around it.
--
-- Assertion 5 is the one that would matter if it ever failed. `page` was added to a table with four
-- existing policies, none of which enumerates columns — so a new column is fenced by construction.
-- "By construction" is exactly the reasoning that is worth checking once, because it stops being
-- true the day somebody writes a column-scoped policy.

begin;
select plan(7);
\ir helpers/seed.sql

insert into deliverables (id, tenant_id, job_id, name, state, revision_round, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000068e1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-00000000f001','Annual report','in_review',0,
   '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000068f1','aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-0000000068e1','k/report-v1.pdf','application/pdf');

set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'), true);

select lives_ok($$
  insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id, page)
  values ('aaaaaaaa-0000-0000-0000-0000000068b1','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000068f1','The chairman''s letter runs long',
          '00000000-0000-0000-0000-00000000a003', 4) $$,
  'a comment can name the page it is about');

select is(
  (select page from review_feedback where id='aaaaaaaa-0000-0000-0000-0000000068b1'), 4,
  'and it is stored 1-based, exactly as the reader sees it in the viewer');

-- ADR-0057 d.3: the anchoring is what a document lacks, not the review loop. A page-anchored
-- comment is an ordinary comment in every other respect.
select is(
  (select round from review_feedback where id='aaaaaaaa-0000-0000-0000-0000000068b1'), 1,
  'a page-anchored comment is stamped into a round like any other');

-- Optional for every format, forever. This is the ordinary case, not the exception.
select lives_ok($$
  insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id)
  values ('aaaaaaaa-0000-0000-0000-0000000068b2','aaaaaaaa-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-0000000068f1','Fonts are wrong throughout',
          '00000000-0000-0000-0000-00000000a003') $$,
  'and a comment with no page at all is still a legal comment');
select is(
  (select page from review_feedback where id='aaaaaaaa-0000-0000-0000-0000000068b2'), null,
  'unanchored means null, not zero — zero is a page nobody can turn to');

-- The constraint. Page 0 is not "no page", it is a number that cannot be shown to anybody.
select throws_ok($$
  insert into review_feedback (tenant_id, media_record_id, body, author_user_id, page)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000068f1',
          'page zero','00000000-0000-0000-0000-00000000a003', 0) $$,
  '23514', null, 'a page below 1 is refused rather than stored and rendered as nothing');

-- Assertion 5: the new column carries no new reach. Tenant B's admin sees no page, because it sees
-- no row — `review_feedback_tenant_select` fences whole rows and never named a column.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id='00000000-0000-0000-0000-00000000b001'), true);
select is(
  (select count(*)::int from review_feedback
    where id in ('aaaaaaaa-0000-0000-0000-0000000068b1','aaaaaaaa-0000-0000-0000-0000000068b2')),
  0, 'another tenant reads neither the comment nor its page');

select * from finish();
rollback;
