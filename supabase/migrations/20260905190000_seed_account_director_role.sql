-- I40 (ADR-0073 d.3) — the Account Director.
--
-- Edward, 5 Sep: *"Account Director is a new role… to differentiate between the account managers and
-- the account director."* Somebody has to act across ALL accounts without being made a Power Admin —
-- a systems role — to solve a campaigns problem. Until now that was the only way to give anyone that
-- reach, and it hands over user administration, roles and the audit log as a side effect.
--
-- ALREADY ASSUMED BY SHIPPED COPY. Step 1 of the Brief Wizard reads *"Only the Account Director or
-- assigned Account Manager can approve this campaign"* with no such role behind it.
--
-- SCOPE IS `account`, NOT `tenant` (ADR-0073, options weighed). `tenant` is the systems tier — it is
-- what makes Power Admin pass every RLS branch — and borrowing it to widen CLIENT reach is how a
-- role acquires powers nobody decided to give it. The Account Director is scoped exactly like the
-- Account Manager and differs in one place only: `app.in_write_scope`'s account branch passes it for
-- every account rather than only those it manages. That branch is the next migration.
--
-- GRANTS ARE THE ACCOUNT MANAGER'S, plus `briefs:approve` (d.6). Copied from the role rather than
-- retyped, so the two cannot drift: an Account Director who could not do what an Account Manager can
-- is not an oversight role. NOTHING ADMINISTRATIVE — not users, not roles, not audit.
--
-- `briefs:approve` IS A FALLBACK, NOT A DEFAULT (Edward). Nothing here enforces that and nothing
-- needs to: ADR-0070 d.6's notification names the department's own leads and deliberately excludes
-- agency-wide roles, so this one is never told a brief is waiting; ADR-0072 d.4 requires the surface
-- to present acting on somebody's behalf as an absence fallback; and `campaign_briefs.approved_by`
-- already answers who is actually approving. A confirmation step or reason field was considered and
-- refused — each turns a failsafe into a delay, and the point of one is that it works the moment
-- somebody is absent.
--
-- IDEMPOTENT AND RE-RUNNABLE per tenant, the house pattern for role seeds: `on conflict do nothing`
-- throughout, so provisioning a tenant twice is a no-op rather than a duplicate-key failure.

begin;

create or replace function app.seed_account_director(p_tenant uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_dir uuid; v_am uuid;
begin
  insert into roles (tenant_id, key, name, description, is_system, default_route, scope)
  values (
    p_tenant, 'account_director', 'Account Director',
    'Oversees every account — campaigns, clients and briefs across all of them. No administration.',
    false, '/campaigns', 'account'
  )
  on conflict (tenant_id, key) do nothing;

  select id into v_dir from roles where tenant_id = p_tenant and key = 'account_director';
  select id into v_am  from roles where tenant_id = p_tenant and key = 'account_manager';

  -- Copied, never retyped. If the Account Manager gains a grant tomorrow, re-running this seed
  -- gives it to the Director too; retyping the list is how the two silently diverge.
  insert into role_grants (tenant_id, role_id, resource, action)
  select p_tenant, v_dir, rg.resource, rg.action
    from role_grants rg
   where rg.role_id = v_am
  on conflict do nothing;

  -- ADR-0073 d.6. Added explicitly rather than inherited, because the Account Manager holds it for a
  -- different reason (ADR-0070 d.3) and this one holds it as the fallback of last resort.
  insert into role_grants (tenant_id, role_id, resource, action)
  values (p_tenant, v_dir, 'briefs', 'approve')
  on conflict do nothing;
end $$;

comment on function app.seed_account_director(uuid) is
  'ADR-0073 d.3/d.6 (I40). Account Director: account-scoped, the Account Manager''s grants copied '
  'rather than retyped, plus briefs:approve as the fallback approver. No administrative grant.';

-- Every existing tenant. New tenants pick it up through the provisioning path that calls the other
-- role seeds; this backfill is what stops the role existing only where somebody remembered.
do $$
declare t record;
begin
  for t in select id from tenants loop
    perform app.seed_account_director(t.id);
  end loop;
end $$;

commit;
