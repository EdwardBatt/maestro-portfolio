-- I22.3 (ADR-0055 d.5, d.6) — changing a deliverable's owner is governed, and the rule is in
-- Postgres.
--
-- ADR-0055's Options section rejects enforcing this in an RPC alone, by the rule ADR-0048 d.8
-- quotes from ADR-0043: a rule that lives only in a function gets walked around. `deliverables`
-- carries a `for all` policy on `project_tasks:manage` with no scope test and no column
-- restriction, so a plain `PATCH /deliverables {"owner_user_id": …}` is a front door standing
-- wide open. **The trigger is the rule; the RPC is the ergonomics.**
--
-- This NARROWS existing behaviour deliberately. Today anybody holding `project_tasks:manage` can
-- reassign any deliverable anywhere in the tenant. After this they need
-- `deliverable_owner:manage` and write scope over the incoming owner, or to be the campaign's own
-- account manager. That is the hole ADR-0055 exists to close, and it is a behaviour change on a
-- live table — which is why it lands with its pgTAP rather than after it.
--
-- Trigger order on `deliverables` is alphabetical, so this runs FIRST:
--   deliverable_owner_guard  →  deliverable_stamp_department  →  deliverable_transition_guard
-- Authority is decided before the department is restamped, and before the transition guard sees
-- either column move.

begin;

create or replace function app.tg_deliverable_owner_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_dept uuid;
  v_team uuid;
  v_subject uuid;
begin
  if new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;

  -- Migrations and seeders escape, as they do in every other guard on this table.
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;

  -- Scope is tested against the person the work is moving TO. When the owner is being CLEARED
  -- there is no such person, so it is tested against the one it is moving FROM — otherwise
  -- `in_write_scope(null, null, null)` is false under department or team scope and nobody but a
  -- tenant-scoped user could ever un-assign a deliverable.
  v_subject := coalesce(new.owner_user_id, old.owner_user_id);

  if v_subject is not null then
    select department_id, team_id into v_dept, v_team
      from user_profiles
     where id = v_subject and tenant_id = old.tenant_id;
    if not found then
      raise exception 'that person is not in your organization' using errcode = '22023';
    end if;
  end if;

  -- ADR-0055 d.3a — the permission, bounded by scope over the incoming owner.
  if app.has_permission('deliverable_owner', 'manage')
     and app.in_write_scope(v_dept, v_team, null) then
    return new;
  end if;

  -- ADR-0055 d.3b — the account manager of THIS deliverable's campaign, regardless of scope,
  -- because it is their campaign. Mirrors the reach `app.is_job_pm` grants a PM over their own
  -- project. Flagged in the ADR as an addition beyond what was asked for.
  if app.deliverable_account_manager(old.id) = auth.uid() then
    return new;
  end if;

  raise exception
    'changing who owns a deliverable needs deliverable_owner:manage within your scope, or being the account manager for its campaign'
    using errcode = '42501';
end $$;

comment on function app.tg_deliverable_owner_guard() is
  'ADR-0055 d.6: the rule governing deliverables.owner_user_id, held in Postgres so a plain '
  'PostgREST PATCH cannot walk around public.reassign_deliverable. Scope is tested against the '
  'incoming owner, or the outgoing one when the owner is being cleared.';

create trigger deliverable_owner_guard
  before update of owner_user_id on deliverables
  for each row execute function app.tg_deliverable_owner_guard();

-- ---------------------------------------------------------------------- the RPC ----
-- SECURITY INVOKER: RLS and the trigger above decide, exactly as they would for a direct write.
-- This exists so the surface has one call with one clear error, not to add authority of its own.
create or replace function public.reassign_deliverable(p_deliverable uuid, p_owner uuid)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  update deliverables set owner_user_id = p_owner where id = p_deliverable;
  if not found then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
end $$;

comment on function public.reassign_deliverable(uuid, uuid) is
  'ADR-0055 d.5: the supported way to change a deliverable''s owner. Adds no authority — '
  'app.tg_deliverable_owner_guard is what decides, so a direct UPDATE is governed identically. '
  'department_id is left to app.tg_deliverable_stamp_department (ADR-0050), never written here.';

revoke execute on function public.reassign_deliverable(uuid, uuid) from public, anon;
grant execute on function public.reassign_deliverable(uuid, uuid) to authenticated;

commit;
