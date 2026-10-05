-- ADR-0025 (I3.2): review_feedback round/source stamping + grant-driven write RLS.
-- Proves: round = deliverable.revision_round + 1 (server-stamped); source forced 'internal';
-- author is auth.uid() (spoof denied); author OR reviews:moderate may resolve, others cannot.
begin;
select plan(11);
\ir helpers/seed.sql

insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000032d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S');
insert into deliverables (id, tenant_id, stream_id, name, state, revision_round, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000032e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032d1','D','in_review',2, '00000000-0000-0000-0000-00000000a001');
insert into media_records (id, tenant_id, deliverable_id, object_key, content_type) values
  ('aaaaaaaa-0000-0000-0000-0000000032f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032e1','k/v1.png','image/png');

set local role authenticated;

-- Author (team_member) comments: round = 2+1 = 3, source internal.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a003'),true);
select lives_ok($$ insert into review_feedback (id, tenant_id, media_record_id, body, author_user_id, pos_x, pos_y)
  values ('aaaaaaaa-0000-0000-0000-00000000ab01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032f1','pin here','00000000-0000-0000-0000-00000000a003',0.5,0.25) $$,
  'author adds an anchored comment');
select is((select round from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab01'), 3, 'round stamped = revision_round + 1');
select is((select source from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab01'), 'internal', 'source stamped internal');

-- Client-sent source is overwritten to internal.
select lives_ok($$ insert into review_feedback (id, tenant_id, media_record_id, body, source, author_user_id)
  values ('aaaaaaaa-0000-0000-0000-00000000ab02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032f1','c2','client','00000000-0000-0000-0000-00000000a003') $$,
  'insert with source=client is accepted');
select is((select source from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab02'), 'internal', 'client source overwritten to internal');

-- Author must be the caller.
select throws_ok($$ insert into review_feedback (tenant_id, media_record_id, body, author_user_id)
  values ('aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000032f1','spoof','00000000-0000-0000-0000-00000000a001') $$,
  '42501', null, 'cannot author a comment as someone else');

-- Author resolves own.
select lives_ok($$ update review_feedback set resolved=true where id='aaaaaaaa-0000-0000-0000-00000000ab01' $$, 'author resolves own comment');
select is((select resolved from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab01'), true, 'own comment resolved');

-- Power admin (reviews:moderate) resolves another author's comment.
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a001'),true);
select lives_ok($$ update review_feedback set resolved=true where id='aaaaaaaa-0000-0000-0000-00000000ab02' $$, 'moderator resolves any comment');
select is((select resolved from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab02'), true, 'moderated comment resolved');

-- Scheduler (no reviews:moderate, not author) cannot edit someone else's comment (USING → 0 rows).
select set_config('request.jwt.claims',(select jwt from test_claims where id='00000000-0000-0000-0000-00000000a002'),true);
update review_feedback set body='hacked' where id='aaaaaaaa-0000-0000-0000-00000000ab01';
select is((select body from review_feedback where id='aaaaaaaa-0000-0000-0000-00000000ab01'), 'pin here', 'non-author non-moderator edit touches nothing');

select * from finish();
rollback;
