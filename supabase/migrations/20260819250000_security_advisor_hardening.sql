-- Security-advisor hardening (Supabase database linter). Forward-only, behaviour-preserving.
-- Addresses ADR-0033. Clears two lint families and leaves the by-design ones documented.
--
--   0011 function_search_path_mutable  — pin a fixed search_path on every app/public function
--        that lacks one, so an unqualified name inside a (esp. SECURITY DEFINER) function cannot
--        be shadowed by an object an attacker plants in an earlier schema.
--   0028 anon_security_definer_function_executable — public.create_internal_project was revoked
--        from `anon` only, but `anon` is a member of PUBLIC and still inherited EXECUTE via the
--        PUBLIC grant. Revoke it from PUBLIC too (deliver_/promote_ already did this).
--
-- NOT changed here (intentional / out of scope, see ADR-0033):
--   * 0029 authenticated_security_definer_function_executable on create_internal_project /
--     deliver_deliverable_version / promote_delivered_version_to_final — these DEFINER RPCs are
--     MEANT to be called by signed-in users and enforce their own app.has_permission checks.
--   * 0014 extension_in_public (btree_gist) — it backs the bookings no-overlap exclusion
--     constraint; relocating it risks a live constraint for a cosmetic warning. Deferred.
--   * auth_leaked_password_protection — a dashboard Auth setting, not SQL.

-- ---- 1. pin search_path on every app/public function missing one -------------------------
-- Fixed path (not '') because the bodies use unqualified references to public tables and app
-- helpers; `extensions` is included for extension-provided functions. pg_catalog is implicitly
-- searched first regardless; pg_temp is intentionally excluded (temp-shadowing hardening).
-- Extension-owned functions (pg_depend deptype 'e', e.g. btree_gist internals) are skipped.
do $$
declare r record;
begin
  for r in
    select n.nspname as sch, p.proname as fn, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.prokind = 'f'
      and p.proconfig is null
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('alter function %I.%I(%s) set search_path = public, app, extensions',
                   r.sch, r.fn, r.args);
  end loop;
end $$;

-- ---- 2. close the anon EXECUTE leak on create_internal_project ----------------------------
-- (deliver_deliverable_version / promote_delivered_version_to_final already revoke from PUBLIC.)
revoke execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) from public;
grant  execute on function public.create_internal_project(text, text, uuid, uuid, uuid, jsonb) to authenticated;
