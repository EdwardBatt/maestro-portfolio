-- I59.31 — the sweep completed:
--   * E8    'campaign_brief' is its own kind (Traffic Manager + the Account Director role), seeded for
--           every tenant and for a new one; a brief waiting for approval escalates under it, not as
--           'task_list'.
--   * hooks change_request (pending, from sent), extension_owner (from asked), extension_am (from the
--           forward), blocked (from raised) — each fires once, in real time, to its rule's people, and
--           leaves Needs you when its stall ends.
--   * E9    a rule that resolves to nobody goes to the Traffic Manager with the reason; one that not
--           even the Traffic Manager can hear is recorded and retried; the admin reads which rules
--           reached nobody.
--
-- Cast (Tenant A): a002 Traffic Manager (seed) · a001 Admin A (organization:manage) · a770 AM 177 ·
-- a771 AD 177 (account_director) · a772 Dept lead 177 (Creative 177) · a773 Owner 177 (team lead,
-- Creative 177) · a774 Maker 177 · a775 Lonely owner 177 (team lead, Content 177, which has no
-- department lead; its campaign has no account manager).
begin;
select plan(32);
\ir helpers/seed.sql
-- ADR-0141 d.5: the request is retired; a pending one (raised before 3 Oct) is raised here as it was then.
\ir helpers/legacy_extension_request.sql
select app.seed_tenant_reminder_settings(id) from tenants;
select app.seed_account_director(id) from tenants;
select app.seed_tenant_escalation_rules(id) from tenants;

insert into departments (id, tenant_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000de1770', 'aaaaaaaa-0000-0000-0000-000000000001', 'Creative 177'),
  ('aaaaaaaa-0000-0000-0000-000000de1771', 'aaaaaaaa-0000-0000-0000-000000000001', 'Content 177');
insert into teams (id, tenant_id, department_id, name) values
  ('aaaaaaaa-0000-0000-0000-00000007e177', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1770', 'Studio 177'),
  ('aaaaaaaa-0000-0000-0000-00000007e178', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000de1771', 'Words 177');
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a770', 'am177@a.test'), ('00000000-0000-0000-0000-00000000a771', 'ad177@a.test'),
  ('00000000-0000-0000-0000-00000000a772', 'dl177@a.test'), ('00000000-0000-0000-0000-00000000a773', 'owner177@a.test'),
  ('00000000-0000-0000-0000-00000000a774', 'maker177@a.test'), ('00000000-0000-0000-0000-00000000a775', 'lonely177@a.test');
insert into user_profiles (id, tenant_id, display_name, role_id, department_id, team_id)
select v.id::uuid, 'aaaaaaaa-0000-0000-0000-000000000001', v.name,
       (select r.id from roles r where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key = v.role_key),
       v.dept::uuid, v.team::uuid
from (values
  ('00000000-0000-0000-0000-00000000a770', 'AM 177',           'account_manager',  null, null),
  ('00000000-0000-0000-0000-00000000a771', 'AD 177',           'account_director', null, null),
  ('00000000-0000-0000-0000-00000000a772', 'Dept lead 177',    'department_lead',  'aaaaaaaa-0000-0000-0000-000000de1770', null),
  ('00000000-0000-0000-0000-00000000a773', 'Owner 177',        'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1770', 'aaaaaaaa-0000-0000-0000-00000007e177'),
  ('00000000-0000-0000-0000-00000000a774', 'Maker 177',        'team_member',      'aaaaaaaa-0000-0000-0000-000000de1770', 'aaaaaaaa-0000-0000-0000-00000007e177'),
  ('00000000-0000-0000-0000-00000000a775', 'Lonely owner 177', 'team_lead',        'aaaaaaaa-0000-0000-0000-000000de1771', 'aaaaaaaa-0000-0000-0000-00000007e178')
) as v(id, name, role_key, dept, team);
insert into test_claims (id, jwt)
select up.id, json_build_object('sub', up.id, 'app_metadata',
         json_build_object('tenant_id', up.tenant_id, 'app_role_id', up.role_id))::text
  from user_profiles up where up.id::text like '00000000-0000-0000-0000-00000000a77%';

insert into campaigns (id, tenant_id, client_id, name, status, kind, account_manager_id) values
  ('aaaaaaaa-0000-0000-0000-000000001771', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Season 177', 'approved', 'campaign', '00000000-0000-0000-0000-00000000a770'),
  ('aaaaaaaa-0000-0000-0000-000000001772', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Orphan 177', 'approved', 'campaign', null),
  ('aaaaaaaa-0000-0000-0000-000000001773', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-00000000c001',
   'Brief 177', 'draft', 'campaign', '00000000-0000-0000-0000-00000000a770');
insert into streams (id, tenant_id, campaign_id, name)
select c.id, c.tenant_id, c.id, c.name from campaigns c where c.id::text like '%00000177%';
insert into deliverables (id, tenant_id, stream_id, name, state, due_at, owner_user_id) values
  ('aaaaaaaa-0000-0000-0000-0000000d1771', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001771',
   'Banner 177', 'in_progress', '2026-10-20 15:00+00', '00000000-0000-0000-0000-00000000a773'),
  ('aaaaaaaa-0000-0000-0000-0000000d1772', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000001772',
   'Leaflet 177', 'in_progress', '2026-10-20 15:00+00', '00000000-0000-0000-0000-00000000a775');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001771');
select test_accept_campaign_work('aaaaaaaa-0000-0000-0000-000000001772');
set local app.system_op = 'on';
insert into sub_tasks (id, tenant_id, deliverable_id, title, status, assignee_id, sla_hours, starts_at, due_at) values
  ('aaaaaaaa-0000-0000-0000-0000000f1771', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1771',
   'Design 177', 'in_progress', '00000000-0000-0000-0000-00000000a774', 8, '2026-10-01 06:00+00', '2026-10-05 15:00+00'),
  ('aaaaaaaa-0000-0000-0000-0000000f1772', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1772',
   'Copy 177', 'in_progress', '00000000-0000-0000-0000-00000000a774', 8, '2026-10-01 06:00+00', '2026-10-05 15:00+00');
set local app.system_op = 'off';
-- ADR-0117 addendum (Q19): a campaign leaves draft with a language.
update campaigns set status = 'pending_approval', languages = array['en'] where id = 'aaaaaaaa-0000-0000-0000-000000001773';

-- ================================================================ E8: the kinds ====
select is((select count(*)::int from tenants t
            where not exists (select 1 from tenant_escalation_rules r where r.tenant_id = t.id and r.kind = 'campaign_brief')),
  0, 'E8: every tenant has a campaign_brief rule');
select is((select array[hours::text, array_length(relative, 1)::text,
                        (role_ids @> array[(select id from roles where tenant_id = r.tenant_id and key = 'scheduler'),
                                           (select id from roles where tenant_id = r.tenant_id and key = 'account_director')])::text]
             from tenant_escalation_rules r where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'campaign_brief'),
  array['24', null, 'true'], 'E8: 24 hours, to the Traffic Manager and the Account Director roles');
select is((select relative from tenant_escalation_rules where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'task_list'),
  array['account_manager'], 'E8: task_list stays the piece''s list waiting on its owner — Traffic + the account manager');
insert into tenants (id, name, slug) values ('cccccccc-0000-0000-0000-000000000177', 'Tenant C 177', 'tenant-c-177');
select public.seed_tenant_roles('cccccccc-0000-0000-0000-000000000177');
select ok(exists (select 1 from tenant_escalation_rules where tenant_id = 'cccccccc-0000-0000-0000-000000000177' and kind = 'campaign_brief'),
  'E8: a tenant provisioned tomorrow gets it too');

select is((app.run_escalation_sweep(now() + interval '23 hours', false, 'campaign_brief') ->> 'sent')::int, 0,
  'the brief, 23 hours after it was sent for approval: nothing');
select is((app.run_escalation_sweep(now() + interval '25 hours', false, 'campaign_brief') ->> 'sent')::int, 1,
  '25 hours: escalated as campaign_brief');
select results_eq($$
  select user_id, detail->>'kind' from notifications
   where type = 'escalated' and entity_id = 'aaaaaaaa-0000-0000-0000-000000001773' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a002'::uuid, 'campaign_brief'),
              ('00000000-0000-0000-0000-00000000a771'::uuid, 'campaign_brief') $$,
  'E8: to the Traffic Manager and the Account Director');
select is((app.run_escalation_sweep(now() + interval '25 hours', false, 'task_list') ->> 'sent')::int, 0,
  'E8: and never again as task_list');

-- ================================================================ the four hooks ====
-- A change request, an extension at the owner's step, a block — all raised now.
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a770'), true);
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1771', '{"quantity":{"to":2}}', 'client') $$,
  'a change request is sent to the owner');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a774'), true);
select lives_ok($$ select test_extension_request('aaaaaaaa-0000-0000-0000-0000000f1771', '2026-10-09', 'More sizes', 'client') $$,
  'an extension is asked — at the owner''s step');
select lives_ok($$ insert into deliverable_pending_inputs (tenant_id, deliverable_id, sub_task_id, kind, description, awaited_from)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-0000000d1771',
                           'aaaaaaaa-0000-0000-0000-0000000f1771', 'client', 'Logo files', 'Kite Card') $$,
  'the maker raises a block');
reset role;

select is((select array_agg(e.kind order by e.kind) from app.escalation_due(now() + interval '7 hours') e
            where e.kind in ('change_request', 'extension_owner', 'extension_am', 'blocked')),
  null, 'at 7 real hours nothing of the four is due');
select is((app.run_escalation_sweep(now() + interval '9 hours', false, 'change_request') ->> 'sent')::int, 1,
  'change_request: 9 hours unanswered — escalated');
select results_eq($$
  select user_id, detail->'as' from notifications where type = 'escalated' and detail->>'kind' = 'change_request' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a770'::uuid, '["account_manager"]'::jsonb),
              ('00000000-0000-0000-0000-00000000a772'::uuid, '["owner_department_lead"]'::jsonb) $$,
  'to the owner''s department lead and the account manager');
select is((app.run_escalation_sweep(now() + interval '9 hours', false, 'extension_owner') ->> 'sent')::int, 1,
  'extension_owner: 9 hours at the owner''s step — escalated');
select is((select array_agg(user_id::text) from notifications where type = 'escalated' and detail->>'kind' = 'extension_owner'),
  array['00000000-0000-0000-0000-00000000a772'], 'to the owner''s department lead');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a773'), true);
select lives_ok($$ select public.forward_extension((select request_id from public.sub_task_extension_requests
                     where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f1771'), 'Agreed, forward') $$,
  'the owner forwards it');
reset role;
select is((app.run_escalation_sweep(now() + interval '9 hours', false, 'extension_am') ->> 'sent')::int, 1,
  'extension_am: 9 hours at the account manager''s step, counted from the forward — escalated');
select is((select array_agg(user_id::text) from notifications where type = 'escalated' and detail->>'kind' = 'extension_am'),
  array['00000000-0000-0000-0000-00000000a771'], 'to the Account Director');
select is((app.run_escalation_sweep(now() + interval '25 hours', false, 'blocked') ->> 'sent')::int, 1,
  'blocked: 25 real hours — escalated');
select results_eq($$
  select user_id from notifications where type = 'escalated' and detail->>'kind' = 'blocked' order by user_id
$$, $$ values ('00000000-0000-0000-0000-00000000a770'::uuid), ('00000000-0000-0000-0000-00000000a773'::uuid) $$,
  'to the owner and the account manager');
select is((app.run_escalation_sweep(now() + interval '30 hours', false, null) -> 'items')
            @? '$[*] ? (@.kind == "change_request" || @.kind == "extension_owner" || @.kind == "extension_am" || @.kind == "blocked")',
  false, 'once per cause: a later sweep sends none of the four again');

-- Needs you: the owner's blocked escalation leaves once the block is cleared.
set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a773'), true);
select ok(exists (select 1 from public.needs_me_escalations() where kind = 'blocked'), 'the owner has the blocked escalation in Needs you');
update deliverable_pending_inputs set satisfied_at = now() where sub_task_id = 'aaaaaaaa-0000-0000-0000-0000000f1771';
select ok(not exists (select 1 from public.needs_me_escalations() where kind = 'blocked'), 'cleared, it leaves');
reset role;

-- ================================================================ E9: nobody → Traffic ====
set local role authenticated;
-- ADR-0141 d.6 (3 Oct): the client's change request is raised only on the account manager's side — on a campaign with
-- no account manager, by the Account Director.
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a771'), true);
select lives_ok($$ select public.request_deliverable_change('aaaaaaaa-0000-0000-0000-0000000d1772', '{"quantity":{"to":3}}', 'us') $$,
  'a change request on a piece whose department has no lead, on a campaign with no account manager');
reset role;
-- First, even the Traffic Manager is away.
update user_profiles set is_active = false where id = '00000000-0000-0000-0000-00000000a002';
select is((app.run_escalation_sweep(now() + interval '9 hours', false, 'change_request') ->> 'sent')::int, 0,
  'E9: nobody at all can hear it — nothing is sent');
select is((select reason from escalation_unreached where kind = 'change_request'),
  'no department lead for Content 177; no account manager on Orphan 177',
  'E9: but it is recorded as unreached, with why, and retried');
update user_profiles set is_active = true where id = '00000000-0000-0000-0000-00000000a002';
select is((app.run_escalation_sweep(now() + interval '10 hours', false, 'change_request') ->> 'sent')::int, 1,
  'E9: the Traffic Manager back — retried, and sent');
select is(
  (select array[user_id::text, detail->'as'->>0, detail->>'fallback_reason'] from notifications
    where type = 'escalated' and detail->>'kind' = 'change_request' and entity_id = 'aaaaaaaa-0000-0000-0000-0000000d1772'),
  array['00000000-0000-0000-0000-00000000a002', 'traffic_fallback', 'no department lead for Content 177; no account manager on Orphan 177'],
  'E9: it went to the Traffic Manager, saying why the rule reached nobody');
select ok((select fallback and fallback_reason like 'no department lead for Content 177%' from escalation_log
            where kind = 'change_request' and recipients = 1 and fallback),
  'E9: the log records the fallback');

set local role authenticated;
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select results_eq($$ select kind, fell_back, unreached, reasons from public.escalation_rules_reaching_nobody() $$,
  $$ values ('change_request'::text, 1, 0, array['no department lead for Content 177; no account manager on Orphan 177']) $$,
  'E9: the admin sees which rule reached nobody, how often and why — the unreached cause cleared once sent');
select set_config('request.jwt.claims', (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a774'), true);
select throws_ok($$ select * from public.escalation_rules_reaching_nobody() $$, '42501', null,
  'E9: a team member cannot read it');
reset role;

select * from finish();
rollback;
