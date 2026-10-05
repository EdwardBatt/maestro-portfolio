-- 20260926191000 (I59.49) — a deliverable's OWNER is told when it is approved; the actor never is.
--
-- The path to `approved` (tasks approved, reviews, the transition guard) is proved elsewhere (023);
-- this suite is about WHO is told, so the transition guard is switched off inside this transaction
-- (rolled back with it) and the state is set directly.
--
-- Cast: a001 owns the deliverables; a002 is the campaign's account manager.
begin;
select plan(6);
\ir helpers/seed.sql

update campaigns set account_manager_id = '00000000-0000-0000-0000-00000000a002'
  where id = 'aaaaaaaa-0000-0000-0000-00000000e001';
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000184d1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000e001','S184');
alter table deliverables disable trigger deliverable_transition_guard;

insert into deliverables (id, tenant_id, stream_id, name, state, owner_user_id, reviewer_id) values
  ('aaaaaaaa-0000-0000-0000-0000000184e1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000184d1',
   'Owned 184 A','in_review','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000184e2','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000184d1',
   'Owned 184 B','in_review','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001'),
  ('aaaaaaaa-0000-0000-0000-0000000184e3','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000184d1',
   'Owned 184 C','in_progress','00000000-0000-0000-0000-00000000a001','00000000-0000-0000-0000-00000000a001');

-- A: approved by somebody else (no signed-in actor here) — the owner and the account manager are told.
update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000184e1';
select is(
  (select count(*)::int from notifications where type = 'signed_off' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e1'
      and user_id = '00000000-0000-0000-0000-00000000a001'),
  1, 'approved: the OWNER is told (the new recipient)');
select is(
  (select count(*)::int from notifications where type = 'signed_off' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e1'
      and user_id = '00000000-0000-0000-0000-00000000a002'),
  1, 'approved: the account manager is told, as before');
select is(
  (select count(*)::int from notifications where type = 'signed_off' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e1'),
  2, 'approved: once each, no duplicates');

-- B: approved BY the owner — they are not told about their own act; the account manager still is.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
update deliverables set state = 'approved' where id = 'aaaaaaaa-0000-0000-0000-0000000184e2';
select set_config('request.jwt.claims', '', true);
select is(
  (select count(*)::int from notifications where type = 'signed_off' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e2'
      and user_id = '00000000-0000-0000-0000-00000000a001'),
  0, 'approved by the owner: the owner is not told about their own act');
select is(
  (select count(*)::int from notifications where type = 'signed_off' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e2'
      and user_id = '00000000-0000-0000-0000-00000000a002'),
  1, 'approved by the owner: the account manager is still told');

-- C: the other transitions keep their recipients — sent for review does not add the owner.
update deliverables set state = 'in_review' where id = 'aaaaaaaa-0000-0000-0000-0000000184e3';
select is(
  (select count(*)::int from notifications where entity_id = 'aaaaaaaa-0000-0000-0000-0000000184e3'
      and user_id = '00000000-0000-0000-0000-00000000a001'),
  0, 'in review: unchanged — the owner is added on approval only');

select * from finish();
rollback;
