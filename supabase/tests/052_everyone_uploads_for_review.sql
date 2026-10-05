-- 20260825130000: every internal role can upload a version for review; the client portal cannot.
--
-- Reported from live use: a user saw the review panel with no upload button. ReviewPanel renders the
-- control only for media:manage holders, and Team Leader, Deputy, Account Manager and the C-suite
-- never had it — an omission in the original seed list, not a decision (Team Leader was given
-- reviews:moderate to review, and nothing to produce with).
--
-- Asserted against a FRESHLY SEEDED tenant, so this tests the product rather than the fixture.

begin;
select plan(4);
\ir helpers/seed.sql

insert into tenants (id, name, slug) values
  ('cccccccc-0000-0000-0000-000000000002', 'Seeded Upload', 'tenant-upl');
select app.seed_tenant_roles('cccccccc-0000-0000-0000-000000000002');

-- ------------------------------------------------ every internal role holds it ----
select is(
  (select count(*)::int from roles r
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000002'
      and r.key <> 'client_portal'
      and not exists (select 1 from role_grants g
                      where g.role_id = r.id and g.resource = 'media' and g.action = 'manage')),
  0,
  'every internal role in a newly seeded tenant can upload for review');

-- Named explicitly, because these four are the ones that could not before.
select is(
  (select count(*)::int from roles r join role_grants g on g.role_id = r.id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000002'
      and g.resource = 'media' and g.action = 'manage'
      and r.key in ('team_lead', 'deputy_team_lead', 'account_manager', 'ceo')),
  4,
  'Team Leader, Deputy, Account Manager and CEO can now upload — the roles that could not');

-- ---------------------------------------------- the portal still cannot ----
select is(
  (select count(*)::int from roles r join role_grants g on g.role_id = r.id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000002'
      and r.key = 'client_portal'
      and g.resource = 'media' and g.action = 'manage'),
  0,
  'the external Client Portal role does NOT get upload — that is a different feature (M10)');

-- The portal's grant set is untouched by this change.
select is(
  (select count(*)::int from roles r join role_grants g on g.role_id = r.id
    where r.tenant_id = 'cccccccc-0000-0000-0000-000000000002' and r.key = 'client_portal'),
  1,
  'and it still holds exactly its one portal:view grant');

select * from finish();
rollback;
