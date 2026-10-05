-- 20261004130000 (ADR-0117 addendum, 4 Oct — Edward Q18 and Q20; I74.35, I74.36) — a deliverable's own languages, and
-- its translation task following them.
--
--   backfill   a deliverable's one `language` becomes its list; with none, its campaign's; one already set is left.
--   default    a deliverable created with none starts with its campaign's; one given its own keeps them.
--   Q18        the account manager adds Kurdish to ONE deliverable: that deliverable has it, the campaign and the
--              other deliverable do not. The last language cannot be taken away; a code not on the list is refused.
--   gate       ADR-0141 d.1 unchanged — on a live campaign the owner and a team member are refused
--              (hint ask_account_manager), by the RPC and by a bare PATCH.
--   Q20        the translation task is renamed to list the languages and its assignee is told
--              (translation_languages_changed); a deliverable with a task list and no translation task gets one,
--              straight after Write Copy.
--
-- Fixtures (tenant A):
--   a271 AM 227        account_manager — the campaign's AM
--   a272 Owner 227     department_lead, Creative 227 — owns the deliverables
--   a273 Maker 227     team_member, Creative 227 — on the translation task
begin;
select plan(25);
\ir helpers/seed.sql
select app.seed_tenant_languages('aaaaaaaa-0000-0000-0000-000000000001');  -- as provisioning does

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a271', 'am227@a.test'),
  ('00000000-0000-0000-0000-00000000a272', 'owner227@a.test'),
  ('00000000-0000-0000-0000-00000000a273', 'maker227@a.test');
insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000000de27', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 227');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid
from (values
  ('00000000-0000-0000-0000-00000000a271', 'AM 227',    'account_manager', null),
  ('00000000-0000-0000-0000-00000000a272', 'Owner 227', 'department_lead', 'aaaaaaaa-0000-0000-0000-00000000de27'),
  ('00000000-0000-0000-0000-00000000a273', 'Maker 227', 'team_member',     'aaaaaaaa-0000-0000-0000-00000000de27')
) as v(id, name, role_key, dept);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000a27%';
insert into resources (id, tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, department_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d2273','aaaaaaaa-0000-0000-0000-000000000001','human','Maker 227','load_based',120.0,100.0,
   '00000000-0000-0000-0000-00000000a273','aaaaaaaa-0000-0000-0000-00000000de27');

-- ================================================================== the backfill ====
-- The column the migration moved and dropped comes back for this transaction only, so its backfill can be run on rows
-- that carry it. The campaign has no languages while the rows go in, so they start empty, as legacy rows did.
alter table deliverables add column language text;
insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id, approved_at, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000c2270','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c001',
   'Campaign 227','approved','campaign','00000000-0000-0000-0000-00000000a271', now(), '{}');
insert into streams (id, tenant_id, campaign_id, name) values
  ('aaaaaaaa-0000-0000-0000-0000000f2270','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000c2270','S227');
insert into deliverables (id, tenant_id, stream_id, name, state, department_id, due_at, owner_user_id, language, quantity) values
  ('aaaaaaaa-0000-0000-0000-0000000e2271','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2270',
   'Poster 227','in_progress','aaaaaaaa-0000-0000-0000-00000000de27','2026-11-20 15:00+00','00000000-0000-0000-0000-00000000a272', null, 1),
  ('aaaaaaaa-0000-0000-0000-0000000e2272','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2270',
   'Banner 227','in_progress','aaaaaaaa-0000-0000-0000-00000000de27','2026-11-20 15:00+00','00000000-0000-0000-0000-00000000a272', ' ar ', 1);
update campaigns set languages = array['en', 'ar'] where id = 'aaaaaaaa-0000-0000-0000-0000000c2270';
select is((select cardinality(languages) from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'), 0,
  'before the backfill a legacy row has no languages');
select app.backfill_deliverable_languages();
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2272'), array['ar'],
  'backfill: a deliverable with its one language set keeps it, as a list');
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'), array['en', 'ar'],
  'backfill: a deliverable with none takes its campaign''s, in the campaign''s order');
select is(app.backfill_deliverable_languages(), 0, 'backfill: run again, nothing more is written');
alter table deliverables drop column language;

-- ================================================================== a new deliverable ====
insert into deliverables (id, tenant_id, stream_id, name, state, department_id, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000e2273','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2270',
   'Reel 227','in_progress','aaaaaaaa-0000-0000-0000-00000000de27','2026-11-20 15:00+00','00000000-0000-0000-0000-00000000a272');
insert into deliverables (id, tenant_id, stream_id, name, state, department_id, due_at, owner_user_id, languages) values
  ('aaaaaaaa-0000-0000-0000-0000000e2274','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000f2270',
   'Kurdish cut 227','in_progress','aaaaaaaa-0000-0000-0000-00000000de27','2026-11-20 15:00+00','00000000-0000-0000-0000-00000000a272',
   array['ku']);
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2273'), array['en', 'ar'],
  'a deliverable created with no languages starts with its campaign''s');
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2274'), array['ku'],
  'one created with its own keeps them');

-- ================================================================== the task lists ====
insert into workflow_templates (id, tenant_id, code, name_en, is_system) values
  ('aaaaaaaa-0000-0000-0000-000000227f01','aaaaaaaa-0000-0000-0000-000000000001', 'WF-227','Test 227', false);
insert into workflow_steps (id, tenant_id, template_id, sort_order, title_en, repeats_per_unit) values
  ('aaaaaaaa-0000-0000-0000-000000227a01','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000227f01', 1, 'Creative Direction', false),
  ('aaaaaaaa-0000-0000-0000-000000227a02','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000227f01', 2, 'Write Copy', false),
  ('aaaaaaaa-0000-0000-0000-000000227a03','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000227f01', 3, 'Create Artwork', false);
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000e2271', 'aaaaaaaa-0000-0000-0000-000000227f01');
select app.materialise_deliverable_workflow('aaaaaaaa-0000-0000-0000-0000000e2272', 'aaaaaaaa-0000-0000-0000-000000227f01');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2271' and title like 'Translation — %'),
  'Translation — Campaign 227 (English, Arabic)', 'the builder names the DELIVERABLE''s languages, in order');
-- Poster's translation task is the maker's; Banner's was taken off its list (deleted), so it has none.
update sub_tasks set assignee_id = '00000000-0000-0000-0000-00000000a273', sla_hours = 4,
                     starts_at = '2026-11-10 06:00+00', due_at = '2026-11-12 15:00+00'
 where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2271' and title like 'Translation — %';
delete from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2272' and title like 'Translation — %';
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-0000000c2270');

-- ================================================================== the gate (ADR-0141 d.1) ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a272'), true);
select throws_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2271', null, array['en', 'ar', 'ku'], null)$$,
  '42501', 'only the account manager changes a deliverable — ask AM 227 to change it',
  'the deliverable''s owner cannot change its languages on a live campaign — she asks the account manager');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a273'), true);
select throws_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2271', null, array['en', 'ar', 'ku'], null)$$,
  '42501', null, 'nor can a team member');
select throws_ok(
  $$update deliverables set languages = array['ku'] where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'$$,
  '42501', null, 'and a bare PATCH by a team member is refused too');
reset role;

-- ================================================================== Q18: the account manager adds Kurdish ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a271'), true);
select lives_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2271', null, array['en', 'ar', 'ku'], null)$$,
  'the account manager adds Kurdish to Poster 227');
reset role;
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'), array['en', 'ar', 'ku'],
  'Poster 227 is made in English, Arabic and Kurdish');
select is((select languages from campaigns where id = 'aaaaaaaa-0000-0000-0000-0000000c2270'), array['en', 'ar'],
  'the campaign''s languages are unchanged — Kurdish is the deliverable''s own');
select is((select languages from deliverables where id = 'aaaaaaaa-0000-0000-0000-0000000e2273'), array['en', 'ar'],
  'and the other deliverables are unchanged');

-- ================================================================== Q20: the translation task follows ====
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2271' and title like 'Translation — %'),
  'Translation — Campaign 227 (English, Arabic, Kurdish)', 'its translation task is renamed to list the three');
select is((select count(*)::int from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2271' and title like 'Translation — %'),
  1, 'still one translation task — renamed, not added');
select results_eq($$
  select user_id, label, entity_type, actor_id, detail ->> 'words'
    from notifications where type = 'translation_languages_changed'
$$, $$ values ('00000000-0000-0000-0000-00000000a273'::uuid, 'Translation — Campaign 227 (English, Arabic, Kurdish)',
               'sub_task', '00000000-0000-0000-0000-00000000a271'::uuid, 'English, Arabic, Kurdish') $$,
  'its assignee — and only she — is told, by the account manager, with the languages');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a271'), true);
select lives_ok(
  $$select public.update_piece_details('aaaaaaaa-0000-0000-0000-0000000e2272', null, array['ar', 'ku'], null)$$,
  'the account manager adds Kurdish to Banner 227, which has no translation task');
reset role;
select is((select array_agg(split_part(title, ' — ', 1) order by sort_order) from sub_tasks
            where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2272' and status <> 'cancelled'),
  array['Creative Direction', 'Write Copy', 'Translation', 'Create Artwork'],
  'it is given one, straight after Write Copy (ADR-0117 d.5)');
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2272' and title like 'Translation — %'),
  'Translation — Campaign 227 (Arabic, Kurdish)', 'naming its languages');
select is((select count(*)::int from notifications where type = 'translation_languages_changed'), 1,
  'a new, unassigned task tells nobody');

-- ================================================================== the list itself ====
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a271'), true);
select throws_ok(
  $$update deliverables set languages = '{}' where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'$$,
  '22023', 'a deliverable is made in at least one language — keep one, or choose another first',
  'the last language cannot be taken away, even by a PATCH from the account manager');
select throws_ok(
  $$update deliverables set languages = array['en', 'zz'] where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'$$,
  '22023', 'that language is not on your organisation''s list — add it with Add language first',
  'a code that is not on the tenant''s list is refused');
select lives_ok(
  $$update deliverables set languages = array['en'] where id = 'aaaaaaaa-0000-0000-0000-0000000e2271'$$,
  'taking languages away down to one is allowed');
reset role;
select is((select title from sub_tasks where deliverable_id = 'aaaaaaaa-0000-0000-0000-0000000e2271' and title like 'Translation — %'),
  'Translation — Campaign 227 (English)', 'and the translation task follows that too');

select * from finish();
rollback;
