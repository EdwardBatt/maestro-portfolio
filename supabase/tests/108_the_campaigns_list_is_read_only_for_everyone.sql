-- ADR-0082 addendum / decision, 12 Sep — projects:view is granted to every non-portal role, so
-- the campaigns list is readable by everyone. The write RLS on campaigns is untouched; this only
-- opens the read surface (the frontend nav/route gate was the only barrier).

begin;
select plan(4);
\ir helpers/seed.sql

select ok(
  exists (select 1 from permission_catalog where resource = 'projects' and action = 'view'),
  'projects:view is in the permission catalogue');

-- Every non-portal role in the seeded tenant holds it.
select is(
  (select count(*)::int from roles r
     where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
       and r.key <> 'client_portal'
       and not exists (
         select 1 from role_grants g
          where g.role_id = r.id and g.resource = 'projects' and g.action = 'view')),
  0, 'every non-portal role holds projects:view');

-- The client portal does NOT — it is not part of the internal app.
select is(
  (select count(*)::int from role_grants g
     join roles r on r.id = g.role_id
    where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and r.key = 'client_portal'
      and g.resource = 'projects' and g.action = 'view'),
  0, 'the client portal does not hold projects:view');

-- Writing a campaign still needs projects:manage — the read grant does not carry write.
select isnt(
  (select count(*)::int from role_grants g
     join roles r on r.id = g.role_id
    where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and g.resource = 'projects' and g.action = 'manage'),
  (select count(*)::int from roles r
     where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001' and r.key <> 'client_portal'),
  'projects:manage is held by fewer roles than projects:view — reading is not writing');

select * from finish();
rollback;
