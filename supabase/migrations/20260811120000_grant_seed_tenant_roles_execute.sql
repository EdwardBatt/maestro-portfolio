-- Fix provisioning: bootstrap-admin.mjs calls public.seed_tenant_roles as
-- service_role over PostgREST. That public function is a SECURITY INVOKER
-- wrapper over app.seed_tenant_roles; the wrapper was granted to service_role
-- (20260802100000) but the inner app function had EXECUTE revoked from public
-- and was never granted to service_role, so the wrapped call failed with
-- "permission denied for function seed_tenant_roles" against a fresh tenant.
--
-- Grant EXECUTE on the inner function to service_role only. anon/authenticated
-- remain revoked (20260802100000), so tenant-role seeding stays a service-side
-- provisioning path — consistent with the wrapper's original intent. [L1.8 L1.10]

grant execute on function app.seed_tenant_roles(uuid) to service_role;
