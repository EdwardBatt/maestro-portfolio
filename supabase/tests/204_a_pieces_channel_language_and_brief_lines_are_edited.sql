-- 20260930124000 (I68.2, ADR-0132 d.2) — update_piece_details: a piece's channel, language and brief lines, edited by
-- those the edit guard admits (here the Power Admin); refused to a team member who is only the piece's reviewer — the
-- reviewer's own update policy must not let them rewrite the brief; the change is audited. Since 20261004130000 (ADR-0117
-- addendum, Q18) the piece has LANGUAGES: any of the tenant's (not only the campaign's), at least one, a code not on
-- the list refused; channel and brief lines still clear when empty.
begin;
select plan(10);
\ir helpers/seed.sql
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');  -- as provisioning does

insert into campaigns (id, tenant_id, client_id, name, status, kind, approved_at, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000204e1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Campaign 204', 'approved', 'campaign', now(), array['en', 'ar']);
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000020451', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000204e1', 'S1');
insert into deliverables (id, tenant_id, stream_id, name, quantity, reviewer_id, department_id, channel, languages, notes) values
  ('aaaaaaaa-0000-0000-0000-0000000204d1', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000020451',
   'Campus OOH', 1, '00000000-0000-0000-0000-00000000a003', 'aaaaaaaa-0000-0000-0000-0000000de0ff',
   'Instagram', array['en'], 'Back to school, A3.');

-- The fixture gives Team Member project_tasks:manage on purpose (helpers/seed.sql); the product does not. Taken away
-- here, so the deny below is the product's team member: the piece's reviewer, holding nothing that edits it.
delete from role_grants where resource = 'project_tasks' and action = 'manage'
   and role_id in (select id from roles where key = 'team_member');
create temp table audit_before as
  select count(*)::int as n from audit_events
   where entity = 'deliverables' and action = 'update' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000204d1';
grant select on audit_before to authenticated;

set local role authenticated;

-- Deny: the piece's reviewer, a team member.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);
select throws_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000204d1', 'TikTok', array['ar'], 'Rewritten')$$,
  '42501', null, 'a reviewer who may not edit the piece cannot rewrite its channel, language or brief lines');

-- Allow: the Power Admin.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select lives_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000204d1', ' TikTok ', array[' ar ', 'en', 'ar'], 'Arabic master, 6-sheet.')$$,
  'the Power Admin edits the piece''s channel, language and brief lines');
reset role;
select is((select channel from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000204d1'), 'TikTok', 'the channel is saved, trimmed');
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000204d1'), array['ar', 'en'],
  'the languages are saved — trimmed, each once, in the order given');
select is((select notes from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000204d1'), 'Arabic master, 6-sheet.', 'the brief lines are saved');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select throws_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000204d1', 'TikTok', array['xx'], null)$$,
  '22023', 'that language is not on your organisation''s list — add it with Add language first',
  'a code that is not on the tenant''s list is refused');
select throws_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000204d1', 'TikTok', array[]::text[], null)$$,
  '22023', 'a deliverable is made in at least one language — choose one', 'an empty list is refused');
select lives_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000204d1', '', array['ku'], '')$$,
  'a language the campaign is not made in is the piece''s own (Q18); empty channel and brief lines clear');
reset role;

select is((select count(*)::int from audit_events
            where entity = 'deliverables' and action = 'update'
              and entity_id = 'aaaaaaaa-0000-0000-0000-0000000204d1') - (select n from audit_before),
  2, 'both edits are in the audit log');
select is((select languages from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000204e1'), array['en', 'ar'],
  'and the campaign''s languages are unchanged');

select * from finish();
rollback;
