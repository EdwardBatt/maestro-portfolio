-- Local development seed (ADR-0081 d.6). Applied by `supabase db reset`, never to any hosted
-- project — `[db.seed]` in config.toml runs this only against the local stack.
--
-- DELIBERATELY SYNTHETIC. Not a copy of production, and it must never become one: production is real
-- client work under real people's names, residency is unsettled (ADR-0044 d.6, reopened by ADR-0049
-- d.6), and two safety properties of the local environment depend on this file staying invented:
--
--   1. EMAIL IS LIVE locally (ADR-0081 d.3). Every account below is a plus-address on one mailbox,
--      so every notification reaches one person. A real address in this file emails a real client.
--      `EMAIL_ALLOWLIST` (d.3a) is the fence that makes that a refusal rather than a habit — set it
--      in supabase/functions/.env, and read `_shared/email-allowlist.ts` before changing it.
--
--   2. B2 IS THE REAL BUCKET (ADR-0081 d.4). `asset-url` builds object keys as
--      `<tenant>/<client>/<folder>/<uuid>-<name>`, so THE TENANT ID BELOW IS THE STORAGE PREFIX.
--      It begins `d0000000` — "dev" — and production has never used it, which is what makes every
--      object this environment uploads removable with one prefix sweep, and unable to collide with
--      anything real.
--
-- Passwords are all `devpassword`. That is fine here and nowhere else.

-- ---------------------------------------------------------------------------------------------
-- TEMPORARY, LOCAL ONLY — a stand-in for `I43.2`. Delete this block when that ADR lands.
--
-- The migrations create 200-odd tables and force RLS on every one, and NOT ONE grants a table
-- privilege. Production works because the Supabase project was created when new projects were given
-- `arwd` on `public` to `authenticated` by default; the current CLI grants only `Dxtm` (truncate,
-- references, trigger, maintain), so on a fresh database every read returns
-- `42501 permission denied for table campaigns` with the RLS policies never even consulted.
--
-- `verify.sh` does not catch it because `scripts/db/local-stub.sql:19` sets the default privileges
-- itself before migrations run — so the whole pgTAP suite has been passing against grants the real
-- schema never asks for. The same gap will break ADR-0081 d.9's second Supabase project.
--
-- This block reproduces what production HAS, exactly, and nothing more:
--   * `authenticated` only. `anon` is deliberately left with nothing — the client portal (M10) is
--     not built, so nothing unauthenticated has any business reading a row, and the four revokes
--     below take it away from `anon` in production anyway.
--   * The four deliberate narrowings are re-applied AFTER the grant, because `revoke update on
--     <table>` drops column-level grants with it. Order matters: `user_profiles` must have its
--     three-column grant restored after its table-wide UPDATE is revoked, or people cannot change
--     their own display name. Get this backwards and `sla_events`, `audit_events` and
--     `campaign_concepts` quietly stop being append-only.
-- ---------------------------------------------------------------------------------------------
grant select, insert, update, delete on all tables in schema public to authenticated;

-- The service_role (the Edge Functions' admin client) is in the same boat on a CLI-provisioned
-- database: the current CLI grants it nothing on `public` either, so every function that runs as
-- service_role — `chat` opening a conversation, `notify-email`, the transition functions — 500s
-- with "permission denied for table …". Production's service_role has these grants by default.
-- No narrowings: service_role is the trusted backend role, not a person. Found 12 Sep (chat 500).
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 20260801090000:33 — table-wide UPDATE replaced by an explicit column list.
revoke update on user_profiles from authenticated, anon;
grant update (display_name, locale, office_id) on user_profiles to authenticated;

-- Append-only: the record of what happened is not editable by the people it is about.
revoke update, delete on sla_events from authenticated, anon;
revoke update, delete on audit_events from authenticated, anon;
-- ADR-0065 addendum (13 Sep): the concept is refined IN PLACE — keep/delete per item — so the UPDATE
-- grant `20260913180000` gives is kept. (The pre-addendum revoke lived here; taking it out is what
-- makes `campaign_concept_mark_item` work after a reset.)

-- ---------------------------------------------------------------------------------------------
-- The tenant. Its id is load-bearing (see 2 above) — do not regenerate it casually.
-- ---------------------------------------------------------------------------------------------
insert into tenants (id, name, slug) values
  ('d0000000-0000-4000-8000-000000000001', 'Maestro Dev', 'maestro-dev')
on conflict (id) do nothing;

-- Roles, permission catalogue and the I38 seeds, exactly as a real tenant gets them. Called rather
-- than hand-written so this file cannot drift from what provisioning actually does.
select public.seed_tenant_roles('d0000000-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------------------------
-- One office, on the working week this agency actually keeps.
-- ISO weekdays: Mon=1 … Sun=7, so Sun–Thu is {7,1,2,3,4} (ADR-0005). Getting this wrong makes every
-- capacity and working-day test lie, and it lies quietly.
-- ---------------------------------------------------------------------------------------------
insert into offices (id, tenant_id, name, timezone, working_days) values
  ('d0000000-0000-4000-8000-00000000f001', 'd0000000-0000-4000-8000-000000000001',
   'Baghdad', 'Asia/Baghdad', '{7,1,2,3,4}'),
  -- A SECOND office with a DIFFERENT working week (Mon–Fri), so the grid can show one office shaded
  -- for a closure the other is not (ADR-0079 d.3), and a booking preview reading THAT office's week.
  ('d0000000-0000-4000-8000-00000000f002', 'd0000000-0000-4000-8000-000000000001',
   'Dubai', 'Asia/Dubai', '{1,2,3,4,5}')
on conflict (id) do nothing;

insert into departments (id, tenant_id, name) values
  ('d0000000-0000-4000-8000-00000000d001', 'd0000000-0000-4000-8000-000000000001', 'Creative'),
  ('d0000000-0000-4000-8000-00000000d002', 'd0000000-0000-4000-8000-000000000001', 'Content'),
  ('d0000000-0000-4000-8000-00000000d003', 'd0000000-0000-4000-8000-000000000001', 'Production'),
  -- Production has NO department lead and TWO team leads (the SJ-02 "name a team lead as owner"
  -- case, ADR-0083 d.11). Strategy has no lead AND no team lead — the "captured, owner blocked" case.
  ('d0000000-0000-4000-8000-00000000d004', 'd0000000-0000-4000-8000-000000000001', 'Strategy')
on conflict (id) do nothing;

-- Two teams under one department, because one team cannot show the difference between "my team" and
-- "my department" — which is most of what write scope decides (ADR-0073).
--
-- Ids are `d1xx` — under `d0xx`, the departments. Every id in this file is HEXADECIMAL, which is not
-- a style choice: a readable-but-invalid `…t001` is rejected as `invalid input syntax for type uuid`
-- and traps.md carries the entry. Mnemonics have to be spelled in a-f.
insert into teams (id, tenant_id, department_id, name) values
  ('d0000000-0000-4000-8000-00000000d101', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000d001', 'Design'),
  ('d0000000-0000-4000-8000-00000000d102', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000d001', 'Motion'),
  -- Production: two teams, each with a team lead and nobody above them.
  ('d0000000-0000-4000-8000-00000000d103', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000d003', 'Studio'),
  ('d0000000-0000-4000-8000-00000000d104', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000d003', 'Edit'),
  -- Content: one team, so Content has a lead, a team lead AND a member (the non-manager A5 case).
  ('d0000000-0000-4000-8000-00000000d105', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000d002', 'Copy')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- People.
--
-- Claims live in `auth.users.raw_app_meta_data` — tenant_id, app_role_id, department_id, team_id —
-- because `app.current_tenant_id()` reads `auth.jwt() -> 'app_metadata'` and nothing else
-- (`20260728110000`). In production `invite-user` sets them; here they are set directly, which is
-- the one part of this file that is version-sensitive: it writes GoTrue's own table.
--
-- Roles are looked up by KEY, never by the ids `seed_tenant_roles` generated, so this survives the
-- role set changing (a sixth reach was added as recently as ADR-0074).
-- ---------------------------------------------------------------------------------------------
do $$
declare
  v_tenant uuid := 'd0000000-0000-4000-8000-000000000001';
  v_office uuid := 'd0000000-0000-4000-8000-00000000f001';
  v_dubai  uuid := 'd0000000-0000-4000-8000-00000000f002';
  v_creative uuid := 'd0000000-0000-4000-8000-00000000d001';
  v_content  uuid := 'd0000000-0000-4000-8000-00000000d002';
  v_production uuid := 'd0000000-0000-4000-8000-00000000d003';
  v_strategy uuid := 'd0000000-0000-4000-8000-00000000d004';
  v_design uuid := 'd0000000-0000-4000-8000-00000000d101';
  v_motion uuid := 'd0000000-0000-4000-8000-00000000d102';
  v_studio uuid := 'd0000000-0000-4000-8000-00000000d103';
  v_edit   uuid := 'd0000000-0000-4000-8000-00000000d104';
  v_copy   uuid := 'd0000000-0000-4000-8000-00000000d105';
  p record;
  v_role uuid;
begin
  -- Every login is `maestro.dev+<tag>@example.test` / `devpassword`. The set exists to make every
  -- scenario in docs/RETEST-REDESIGN.md and docs/E2E-PLAN.md reachable without inventing people
  -- mid-test: a department with a lead (Creative), one with only team leads (Production), one with
  -- nobody senior (Strategy); two team leads in one department (F6 "one of THEIR team leads");
  -- a deputy; a member in every department (cross-department requests, ADR-0087); an Account
  -- Director (G4); a second Account Manager (reach = own accounts); a second office (M4); an
  -- Arabic-locale user (L4); an executive read-only role (L5).
  for p in
    select * from (values
      -- id, plus-tag, display name, role key, department, team, office, locale
      ('d0000000-0000-4000-8000-00000000a001'::uuid, 'admin',    'Dev Admin',         'power_admin',       null::uuid,   null::uuid, v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a002'::uuid, 'traffic',  'Dev Traffic',       'scheduler',         null,         null,       v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a003'::uuid, 'am',       'Dev Account Mgr',   'account_manager',   null,         null,       v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a004'::uuid, 'lead',     'Dev Dept Lead',     'department_lead',   v_creative,   null,       v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a005'::uuid, 'tl',       'Dev Team Lead',     'team_lead',         v_creative,   v_design,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a006'::uuid, 'maker',    'Dev Maker',         'team_member',       v_creative,   v_design,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a007'::uuid, 'content',  'Dev Content Lead',  'department_lead',   v_content,    null,       v_office, 'en'),
      -- Creative, continued: a second team lead (Motion), a deputy in Design, a Motion member in Arabic.
      ('d0000000-0000-4000-8000-00000000a008'::uuid, 'motiontl', 'Dev Motion Lead',   'team_lead',         v_creative,   v_motion,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a009'::uuid, 'deputy',   'Dev Deputy Lead',   'deputy_team_lead',  v_creative,   v_design,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a00a'::uuid, 'animator', 'Dev Animator',      'team_member',       v_creative,   v_motion,   v_office, 'ar'),
      -- Content: a team lead and a member (a non-manager in a department WITH a lead).
      ('d0000000-0000-4000-8000-00000000a00b'::uuid, 'copytl',   'Dev Copy Lead',     'team_lead',         v_content,    v_copy,     v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a00c'::uuid, 'writer',   'Dev Writer',        'team_member',       v_content,    v_copy,     v_office, 'en'),
      -- Production: NO department lead. Two team leads, a member each; the Edit member sits in Dubai.
      ('d0000000-0000-4000-8000-00000000a00d'::uuid, 'studiotl', 'Dev Studio Lead',   'team_lead',         v_production, v_studio,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a00e'::uuid, 'edittl',   'Dev Edit Lead',     'team_lead',         v_production, v_edit,     v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a00f'::uuid, 'producer', 'Dev Producer',      'team_member',       v_production, v_studio,   v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a010'::uuid, 'editor',   'Dev Editor (Dubai)','team_member',       v_production, v_edit,     v_dubai,  'en'),
      -- Strategy: nobody senior at all — one member.
      ('d0000000-0000-4000-8000-00000000a011'::uuid, 'planner',  'Dev Planner',       'team_member',       v_strategy,   null,       v_office, 'en'),
      -- Accounts and oversight.
      ('d0000000-0000-4000-8000-00000000a012'::uuid, 'ad',       'Dev Account Dir',   'account_director',  null,         null,       v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a013'::uuid, 'am2',      'Dev Account Mgr 2', 'account_manager',   null,         null,       v_office, 'en'),
      ('d0000000-0000-4000-8000-00000000a014'::uuid, 'ceo',      'Dev CEO',           'ceo',               null,         null,       v_office, 'en')
    ) as t(id, tag, name, role_key, dept, team, office, locale)
  loop
    select r.id into v_role from roles r where r.tenant_id = v_tenant and r.key = p.role_key;
    if v_role is null then
      raise exception 'seed: no role % in the seeded set — has seed_tenant_roles changed?', p.role_key;
    end if;

    -- The four token columns are NULLABLE WITH NO DEFAULT, and they must still be written as ''.
    -- GoTrue scans them into non-nullable Go strings, so a NULL makes it fail the whole lookup with
    -- `500 Database error querying schema` at sign-in — a message that names neither the column nor
    -- the row, and reads like the database being down rather than one field being absent. Leaving
    -- them out is the single most likely way to break this file.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      raw_app_meta_data, raw_user_meta_data
    ) values (
      '00000000-0000-0000-0000-000000000000', p.id, 'authenticated', 'authenticated',
      'maestro.dev+' || p.tag || '@example.test',
      extensions.crypt('devpassword', extensions.gen_salt('bf')),
      now(), now(), now(),
      '', '', '', '',
      jsonb_build_object(
        'provider', 'email', 'providers', jsonb_build_array('email'),
        'tenant_id', v_tenant, 'app_role_id', v_role,
        'department_id', p.dept, 'team_id', p.team),
      '{}'::jsonb
    ) on conflict (id) do nothing;

    insert into user_profiles (id, tenant_id, display_name, email, role_id, department_id, team_id, office_id, locale)
    values (p.id, v_tenant, p.name, 'maestro.dev+' || p.tag || '@example.test',
            v_role, p.dept, p.team, p.office, p.locale)
    on conflict (id) do nothing;

    -- ADR-0011: an internal user IS a bookable resource. Without this nobody can be given work, and
    -- ADR-0061 d.5 made that failure depend on the link existing — so a seed without it models an
    -- agency where assignment silently does nothing.
    -- department_id / team_id on the RESOURCE, not only the profile: `resource_in_write_scope` reads
    -- the resource's placement, so a resource without one is reachable by nobody but the tenant-wide
    -- roles — which made every seeded person "unplaced" and hid the whole scope model from testing
    -- (found while drafting ADR-0087, 11 Sep).
    insert into resources (tenant_id, kind, name, capacity_model, load_ceiling_pct, warn_at_pct, user_id, office_id, department_id, team_id)
    values (v_tenant, 'human', p.name, 'load_based', 120.0, 100.0, p.id, p.office, p.dept, p.team)
    on conflict do nothing;
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- Clients, a brand, and two campaigns — built through the PRODUCT'S OWN path.
--
-- `public.create_campaign_from_brief` + `public.approve_campaign` are what the brief wizard calls,
-- so the fixture is whatever the product actually produces and cannot drift from it. Hand-written
-- rows were the first cut and they were wrong in a way that showed immediately: a campaign with a
-- name, a client and `status = 'approved'` and NOTHING else — no brief, no go-live, no account
-- manager, no stream, no deliverables. It rendered as a live campaign containing nothing, which
-- reads as a broken screen rather than an empty one (Edward, 10 Sep).
--
-- The RPC reads `app.current_tenant_id()` from the JWT, so the claims are set first. Postgres
-- bypasses RLS here; the claim supplies the TENANT, and `auth.uid()` the actor stamped on approval.
--
-- **This deliberately reverses "no work in the seed".** The intake redesign has to answer "is this
-- already being done?" and "add this to an existing campaign" — neither can be exercised, or even
-- designed against, with an empty database. Work created through the new flow is still obviously
-- new; what was missing was anything for it to be compared WITH.
-- ---------------------------------------------------------------------------------------------
insert into clients (id, tenant_id, name, account_manager_id) values
  ('d0000000-0000-4000-8000-00000000c001', 'd0000000-0000-4000-8000-000000000001',
   'Northwind Beverages', 'd0000000-0000-4000-8000-00000000a003'),
  ('d0000000-0000-4000-8000-00000000c002', 'd0000000-0000-4000-8000-000000000001',
   'Harbour Line Logistics', 'd0000000-0000-4000-8000-00000000a003'),
  -- The second Account Manager's account: an AM's reach is their OWN accounts (ADR-0073), which one
  -- AM with every client cannot show.
  ('d0000000-0000-4000-8000-00000000c003', 'd0000000-0000-4000-8000-000000000001',
   'Luma Retail', 'd0000000-0000-4000-8000-00000000a013'),
  -- A client with NO account manager — the one case SJ-02's owner pre-fill cannot cover.
  ('d0000000-0000-4000-8000-00000000c004', 'd0000000-0000-4000-8000-000000000001',
   'Orphan Trading', null)
on conflict (id) do nothing;

-- Northwind's dos and don'ts (the client profile's rules, src/lib/brief/rules.ts): every job released
-- for it inherits them, so the rules panels — Before you start, the task page, the review screen
-- (ADR-0112) — have something real to show on a fresh database.
update clients set profile = coalesce(profile, '{}'::jsonb) || jsonb_build_object('rules', jsonb_build_array(
    jsonb_build_object('kind', 'do',   'text', 'Arabic is the master; English follows it'),
    jsonb_build_object('kind', 'do',   'text', 'The bottle is visible in every frame'),
    jsonb_build_object('kind', 'dont', 'text', 'Never show a price without the offer terms')))
 where id = 'd0000000-0000-4000-8000-00000000c001';
insert into brands (id, tenant_id, client_id, name) values
  ('d0000000-0000-4000-8000-00000000ba01', 'd0000000-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-00000000c001', 'Northwind')
on conflict (id) do nothing;

do $seed$
declare
  v_tenant  uuid := 'd0000000-0000-4000-8000-000000000001';
  v_admin   uuid := 'd0000000-0000-4000-8000-00000000a001';
  v_am      uuid := 'd0000000-0000-4000-8000-00000000a003';
  v_lead    uuid := 'd0000000-0000-4000-8000-00000000a004';   -- Creative lead
  v_tl      uuid := 'd0000000-0000-4000-8000-00000000a005';   -- Creative / Design
  v_conlead uuid := 'd0000000-0000-4000-8000-00000000a007';   -- Content lead
  v_content uuid := 'd0000000-0000-4000-8000-00000000d002';   -- the Content department
  v_role    uuid;
  v_campaign uuid;
  ty jsonb;
begin
  select role_id into v_role from user_profiles where id = v_admin;
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_admin,
    'app_metadata', json_build_object('tenant_id', v_tenant, 'app_role_id', v_role)
  )::text, true);

  -- Types by CODE, never by id: the catalogue is seeded per tenant with generated ids.
  select jsonb_object_agg(code, id) into ty
    from deliverable_types
   where tenant_id = v_tenant and code in ('ADV-003', 'ADV-006', 'ADV-012');

  -- 1. A campaign that is RUNNING. Deliverables across two departments, because a deliverable's
  --    department is stamped from its OWNER, and one department cannot show scope doing anything.
  v_campaign := public.create_campaign_from_brief(
    'd0000000-0000-4000-8000-00000000c001',
    'd0000000-0000-4000-8000-00000000ba01',
    'Northwind Summer Launch',
    jsonb_build_object(
      'audiencePrimary', 'Adults 18-34 in Baghdad and Basra, buying chilled drinks on the way home',
      'insight',         'The evening commute is long and hot, and the fridge at home is the reward.',
      'proposition',     'Cold before you get there.',
      'objectives',      'Launch the summer range; 30% aided awareness by the end of August.',
      'mandatories',     'Arabic first. The bottle is visible in every frame.',
      -- ADR-0117 addendum (Q19, 4 Oct): a campaign leaves draft with at least one language.
      'languages',       jsonb_build_array('ar', 'en')),
    now() + interval '42 days',
    jsonb_build_array(
      jsonb_build_object('workstreamKey', 'visuals', 'name', 'Key visual - summer range', 'ownerUserId', v_tl,
                         'deliverableTypeId', ty ->> 'ADV-006', 'quantity', 1, 'channel', 'OOH',
                         'dueAt', (now() + interval '21 days')::text),
      jsonb_build_object('workstreamKey', 'visuals', 'name', 'Social launch films', 'ownerUserId', v_tl,
                         'deliverableTypeId', ty ->> 'ADV-012', 'quantity', 3, 'channel', 'Instagram',
                         'dueAt', (now() + interval '28 days')::text),
      jsonb_build_object('workstreamKey', 'visuals', 'name', 'Social statics', 'ownerUserId', v_lead,
                         'deliverableTypeId', ty ->> 'ADV-003', 'quantity', 6, 'channel', 'Instagram',
                         'dueAt', (now() + interval '30 days')::text),
      jsonb_build_object('workstreamKey', 'copy', 'name', 'Launch copy and captions', 'ownerUserId', v_conlead,
                         'deliverableTypeId', ty ->> 'ADV-003', 'quantity', 1, 'channel', 'Instagram',
                         'dueAt', (now() + interval '25 days')::text)),
    v_am,
    -- ADR-0116 (27 Sep): every piece of a campaign is in a workstream.
    p_workstreams => jsonb_build_array(
      jsonb_build_object('key', 'visuals', 'name', 'Launch visuals', 'departmentId', 'd0000000-0000-4000-8000-00000000d001'),
      jsonb_build_object('key', 'copy', 'name', 'Launch copy', 'departmentId', v_content)));
  perform public.approve_campaign(v_campaign);

  -- Content has WRITTEN its brief and not yet approved it (ADR-0072 d.6): the department tab's
  -- concepts panel, the campaigns list's "n of m" cell and the Arabic walk (retest H4 / L4 / N1)
  -- all read a written brief on this campaign. Creative's is deliberately still unwritten, so the
  -- "owing a brief" line and the assignment gate (`20260920150000`) both have something to say.
  insert into campaign_briefs (tenant_id, campaign_id, department_id, brief_type, values)
  values (v_tenant, v_campaign, v_content, 'social_calendar', jsonb_build_object(
    'objective',       'Make the summer range the drink people reach for on the commute home.',
    'periodVolume',    'Eight weeks from launch; three posts a week on Instagram.',
    'audience',        'Adults 18-34 in Baghdad and Basra, commuting in the evening heat.',
    'toneOfVoice',     'Cool, brief, a little wry. Arabic first.',
    'platformsFormats','Instagram reels and statics; captions under 20 words.',
    'keyDates',        'Launch week, the first heatwave, the last week of August.',
    'mandatories',     'The bottle is visible in every frame.',
    'contentPillars',  'The commute; the fridge at home; the first sip.',
    'visualDirection', 'Condensation, late light, the road home.',
    'kpis',            '30% aided awareness by the end of August.',
    'boosting',        'N/A'));

  -- 2. One left PENDING APPROVAL, so the approval gate and the campaigns list's two states are both
  --    reachable without editing a row by hand.
  perform public.create_campaign_from_brief(
    'd0000000-0000-4000-8000-00000000c002', null,
    'Harbour Line Rebrand',
    jsonb_build_object(
      'audiencePrimary', 'Freight buyers at mid-size importers',
      'insight',         'Nobody picks a freight partner for the logo; they pick it for arriving on the day.',
      'proposition',     'On the day, every day.',
      'languages',       jsonb_build_array('en')),
    now() + interval '90 days',
    jsonb_build_array(
      -- ADR-0093 addendum d.7 (20 Sep): a deliverable is never created without a due date.
      jsonb_build_object('workstreamKey', 'identity', 'name', 'Identity refresh', 'ownerUserId', v_lead,
                         'deliverableTypeId', ty ->> 'ADV-006', 'quantity', 1,
                         'dueAt', (now() + interval '60 days')::text)),
    v_am,
    p_workstreams => jsonb_build_array(
      jsonb_build_object('key', 'identity', 'name', 'Identity', 'departmentId', 'd0000000-0000-4000-8000-00000000d001')));

  perform set_config('request.jwt.claims', '', true);
end $seed$;

-- ---------------------------------------------------------------------------------------------
-- The email slow lane, LOCALLY. `app.tg_notification_email` (20260818150000) enqueues a call to
-- `notify-email` through pg_net, reading the function URL and the bearer from Vault — and skips
-- quietly when either is absent. On a reset both are absent, so no notification is ever emailed
-- here and the inbox looks like the whole story. These two rows make the local database call the
-- local Edge runtime exactly as production calls the hosted one: `host.docker.internal` is the
-- host from inside the db container, and the bearer is the CLI's fixed local service-role key
-- (notify-email compares it to SUPABASE_SERVICE_ROLE_KEY). With `EMAIL_TRANSPORT=mailpit` in
-- supabase/functions/.env the mail lands in Mailpit (http://127.0.0.1:54324), never at Resend.
-- ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('vault.secrets') is null then return; end if;
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret('http://host.docker.internal:54321', 'project_url');
  end if;
  if not exists (select 1 from vault.secrets where name = 'notify_email_bearer') then
    perform vault.create_secret(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
      'notify_email_bearer');
  end if;
end $$;

