-- L1.1/L1.2 (ADR-0007): user administration for team launch.
--
-- 1) user_profiles.email — display mirror of auth.users.email so the Users
--    admin screen can list emails without admin-API round-trips. Written ONLY
--    by the provisioning Edge Functions (invite-user / update-user); the
--    column-privilege lockdown below keeps every client-side writer out.
--
-- 2) Column-level UPDATE lockdown on user_profiles. The claim (app_metadata.
--    app_role) and the profile row must never diverge, so role / is_active /
--    email / tenant_id changes are reserved to the service-role functions
--    that update BOTH sides atomically. PostgREST clients (any role, admin
--    included) may only update the harmless display fields; RLS policies
--    still decide WHICH rows (self, or admin over the tenant).
--
-- Backward-safe against live data (ADR-0007): additive column + backfill +
-- privilege narrowing; no rewrites, no locks beyond ACCESS EXCLUSIVE moments.

alter table user_profiles add column email text;

comment on column user_profiles.email is
  'Mirror of auth.users.email, maintained by the admin Edge Functions only. '
  'Client updates are blocked by column privileges.';

-- Backfill from auth.users (migrations run as the table owner, which can
-- read the auth schema on Supabase and in the local pgTAP harness alike).
update user_profiles up
set email = u.email
from auth.users u
where u.id = up.id and up.email is null;

-- Privilege narrowing: table-wide UPDATE is replaced by an explicit column
-- list. service_role is untouched (Edge Functions keep full access).
revoke update on user_profiles from authenticated, anon;
grant update (display_name, locale, office_id) on user_profiles to authenticated;
