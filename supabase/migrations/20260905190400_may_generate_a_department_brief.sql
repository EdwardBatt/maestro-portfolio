-- I40 (ADR-0072 d.2/d.3) — one doorway answering "may I generate this department's brief, now?".
--
-- `generate-brief` asks `hasProjectsManage(authHeader)` — a tenant-wide boolean. It never asks WHOSE
-- department, and it never asks whether the campaign is approved. It cannot: the request carries
-- neither id. So a Creative lead can generate Production's brief on a campaign they have nothing to
-- do with, and any holder can generate briefs against a `draft` campaign whose deliverables the
-- account manager may still delete.
--
-- WHY ONE FUNCTION AND NOT THREE CHECKS IN DENO. ADR-0037: authorization is read in the database,
-- and no Edge Function may assemble it from parts. Scope lives in `app.in_write_scope`; putting
-- "grant AND scope AND status" in TypeScript would be a fourth copy of a rule that already moved
-- once without its copies. `app` is not exposed over PostgREST, so this `public` wrapper is the
-- doorway, exactly as `public.has_permission` (20260824100000) is for the grant check.
--
-- IT RETURNS A REASON, NOT A BOOLEAN. ADR-0072 names this consequence directly: the function "can now
-- fail for a reason unrelated to the caller — the UI must say 'the campaign is not approved yet'
-- rather than a permission error." A boolean would collapse those into one 403 and the department
-- lead would be told they lack permission when they are simply early.
--
-- `security definer` (ADR-0033 / AGENTS.md §6): it reads `campaigns` and calls two `app` helpers
-- that are themselves definer. `search_path` is pinned. It DECIDES nothing and WRITES nothing — it
-- reports, and the caller enforces.

begin;

create or replace function public.may_generate_department_brief(
  p_campaign uuid,
  p_department uuid
) returns text
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare v campaigns;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();

  -- Tenant-fenced, so a campaign in another tenant is "not found" rather than "forbidden". Telling
  -- a caller that somebody else's campaign exists is itself a leak.
  if v.id is null then return 'not_found'; end if;

  -- ADR-0072 d.1/d.2: the grant is necessary and never sufficient. The department is the subject
  -- here, so it is passed as the department axis; `p_account_manager` is the campaign's, which is
  -- what lets an account-scoped caller reach their own campaign's departments.
  if not app.has_permission('projects', 'manage') then return 'forbidden'; end if;
  if not app.in_write_scope(p_department, null, v.account_manager_id) then return 'forbidden'; end if;

  -- ADR-0072 d.3. LAST, deliberately: somebody who could never generate this brief is told that,
  -- not told to come back after approval and then refused.
  if v.status is distinct from 'approved' then return 'campaign_not_approved'; end if;

  return 'ok';
end $$;

comment on function public.may_generate_department_brief(uuid, uuid) is
  'ADR-0072 d.2/d.3 (I40). The doorway generate-brief calls instead of assembling grant + scope + '
  'status itself. Returns ok | forbidden | campaign_not_approved | not_found — a reason rather than '
  'a boolean, because "you are early" and "you are not allowed" are different sentences.';

revoke all on function public.may_generate_department_brief(uuid, uuid) from public, anon;
grant execute on function public.may_generate_department_brief(uuid, uuid) to authenticated;

commit;
