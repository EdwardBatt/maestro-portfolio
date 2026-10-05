-- ADR-0092 d.3 / I48.11 — who to email when a user reports an error.
--
-- The "Report to your administrator" button on an error dialog sends the failure to the tenant's
-- Power Admin(s). This function returns their recorded emails for the caller's own tenant, so the
-- report-error Edge Function never reads a grant (or role) table itself — it calls this RPC, keeping
-- ADR-0037 intact. This is RECIPIENT ROUTING, not an access decision: it names the power_admin role
-- because that role IS the designated administrator to tell, not to gate anyone's permissions (so
-- ADR-0074's "no function decides ACCESS by a role name" is not in play here).

begin;

create or replace function public.power_admin_emails()
returns setof text
language sql
stable
security definer
set search_path = public, app, extensions as $$
  select up.email
  from user_profiles up
  join roles r on r.id = up.role_id and r.tenant_id = up.tenant_id
  where up.tenant_id = app.current_tenant_id()
    and up.is_active
    and r.key = 'power_admin'
    and up.email is not null;
$$;

comment on function public.power_admin_emails() is
  'ADR-0092 d.3: the recorded emails of the current tenant''s active Power Admin(s), for the '
  'report-error function to address a user''s error report. Recipient routing, not authorization — '
  'the function calls this rather than reading a role/grant table itself (ADR-0037).';

revoke execute on function public.power_admin_emails() from public, anon;
grant  execute on function public.power_admin_emails() to authenticated;

commit;
