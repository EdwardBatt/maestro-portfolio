-- I56.8 / I56.9 / I56.10 (24 Sep) — the three columns section C added to a piece and a phase, and
-- the one rule about codes that only shows up when two campaigns meet.
--
--   * NOTES vs THE BRIEF'S WORDS — `deliverables.notes` is the account manager's own aside and
--     `content_idea` is the line the creative reads first. Two fields, because the brief's words
--     about a row are evidence (ADR-0097 d.2) and a person overwriting them destroys the only
--     record of why the row was proposed. Both free text, both optional.
--   * A PHASE ENDS ON AN EVENT — `campaign_phases.ends_on_event` (CB-v3-P1). Nullable, because
--     ADR-0096 d.1 keeps phases optional and a phase may simply end on its date.
--   * A CODE IS ISSUED ONCE, WITHIN ITS CAMPAIGN — and re-issued when the piece joins another one.
--     This is the assertion worth having. "The code never changes" (I56.9) means never within its
--     campaign: not on a rename, not on a move between workstreams. It CANNOT mean more, because
--     the code is only unique per campaign — `uq_deliverables_campaign_code` is on (stream_id,
--     code). `attach_job_to_campaign` moves a draft job's rows onto the campaign it duplicates,
--     and `WS-001` is the first code almost every campaign issues, so two campaigns meeting is the
--     ordinary case. pgTAP 106 found this by dying on the duplicate key.
begin;
select plan(12);
\ir helpers/seed.sql

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1510', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 151');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a160', 'am151@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
values ('00000000-0000-0000-0000-00000000a160', 'aaaaaaaa-0000-0000-0000-000000000001', 'AM 151',
        (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = 'account_manager'),
        null);

-- Two campaigns. The second is the one a job is attached TO, which is how a piece changes campaign.
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001520','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 151','approved','campaign','00000000-0000-0000-0000-00000000a160'),
  ('aaaaaaaa-0000-0000-0000-000000001521','aaaaaaaa-0000-0000-0000-000000000001',
   (select client_id from campaigns where id = 'aaaaaaaa-0000-0000-0000-00000000e001'),
   'Season 151 b','approved','campaign','00000000-0000-0000-0000-00000000a160');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000f160','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001520','Season 151'),
  ('aaaaaaaa-0000-0000-0000-00000000f161','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000001521','Season 151 b');

-- ============================================== the piece's own words ====
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id,
                          content_idea, notes)
values ('aaaaaaaa-0000-0000-0000-0000000d1510','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000f160','Post 2 — the payment-chime carousel','draft',
        now() + interval '10 days','00000000-0000-0000-0000-00000000a160',
        'Everyday purchases become tickets; say where to find them.',
        'Client wants the Kurdish cut first. Legal have seen the number.');

select is(
  (select content_idea from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'Everyday purchases become tickets; say where to find them.',
  'a piece carries the line the creative reads first (I56.8)');

select is(
  (select notes from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'Client wants the Kurdish cut first. Legal have seen the number.',
  'and the account manager''s own notes, which are a different field entirely');

-- Both optional: a piece listed before anybody has had the idea is a normal, permanent state.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id)
values ('aaaaaaaa-0000-0000-0000-0000000d1511','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000f160','key visuals 151','draft',
        now() + interval '12 days','00000000-0000-0000-0000-00000000a160');
select is(
  (select coalesce(content_idea, '') || coalesce(notes, '')
     from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1511'),
  '', 'a piece can be listed before anybody has written either of them');

-- ==================================================== a phase's event ====
insert into campaign_phases (id, tenant_id, campaign_id, number, name, starts_on, ends_on, ends_on_event)
values ('aaaaaaaa-0000-0000-0000-0000000f1510','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000001520', 1, 'Week 2', '2026-09-26', '2026-10-02', 'Draw Night 2'),
       ('aaaaaaaa-0000-0000-0000-0000000f1511','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000001520', 2, 'Wrap', '2026-10-03', '2026-10-09', null);

select is(
  (select ends_on_event from campaign_phases where id = 'aaaaaaaa-0000-0000-0000-0000000f1510'),
  'Draw Night 2', 'a phase ends on a named event, not on a date somebody typed (I56.10)');
select is(
  (select ends_on_event from campaign_phases where id = 'aaaaaaaa-0000-0000-0000-0000000f1511'),
  null, 'and a phase that simply ends on its date is left alone — phases stay optional');

-- ============================================================= the code ====
-- Both pieces are ungrouped, so both take the WS fallback letters and count up within the campaign.
select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'WS-001', 'ungrouped work still gets a code, from the WS fallback (ADR-0099 d.1)');
select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1511'),
  'WS-002', 'and the number counts up within the campaign');

-- A rename does not touch it. This is the whole point of a code: it is how a person refers to a
-- piece out loud, and one that moved would be worse than none.
update deliverables set name = 'Post 2 — renamed'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1510';
select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'WS-001', 'renaming a piece does not re-issue its code (I56.9)');

-- Nor does a move between workstreams inside the same campaign: the letters come from the group,
-- but the code was issued once and the campaign has not changed.
insert into workstreams (id, tenant_id, campaign_id, name, department_id)
values ('aaaaaaaa-0000-0000-0000-00000000c151','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000001520','Design & Animation','aaaaaaaa-0000-0000-0000-000000de1510');
update deliverables set workstream_id = 'aaaaaaaa-0000-0000-0000-00000000c151'
 where id = 'aaaaaaaa-0000-0000-0000-0000000d1510';
select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'WS-001', 'moving between workstreams does not re-issue it either — same campaign');

-- The second campaign issues its own WS-001, which is exactly why a move collides.
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id)
values ('aaaaaaaa-0000-0000-0000-0000000d1512','aaaaaaaa-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-00000000f161','teaser 151','draft',
        now() + interval '9 days','00000000-0000-0000-0000-00000000a160');
select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1512'),
  'WS-001', 'another campaign issues its own WS-001 — the code is unique per campaign, not estate-wide');

-- The move itself. Before the fix this raised `duplicate key value violates unique constraint
-- "uq_deliverables_campaign_code"`, which is how pgTAP 106 died.
select lives_ok(
  $$update deliverables set stream_id = 'aaaaaaaa-0000-0000-0000-00000000f161'
     where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'$$,
  'a piece joining another campaign does not collide with that campaign''s numbering');

select is(
  (select code from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000d1510'),
  'WS-002', 'it takes the next number in its new campaign, keeping its letters');

select finish();
rollback;
