-- I52.13 (Edward, 17 Sep) — a deliverable can be renamed on its campaign or job.
--
-- Nothing offered it: the wizard names a deliverable at creation and no surface could change the
-- name afterwards — and since 17 Sep a single job's deliverable is named from its type (I52.1), so
-- "Social Advertisement" is what most of them are called until somebody can say otherwise.
--
-- The shape is ADR-0055's for the owner: the RULE lives in a trigger on the column, so a plain
-- PostgREST PATCH is governed exactly as the RPC is (ADR-0037), and the RPC exists so the surface
-- has one call with one clear error. Who may: somebody with project_tasks:manage whose reach
-- covers the deliverable's department (the same test that lets them edit its tasks), or the
-- deliverable's owner, or the campaign's account manager. A blank name is refused.
--
-- What renaming does NOT do: a task's title was composed as "step — deliverable" at creation and
-- is copied, never re-derived (ADR-0052 d.14); it keeps the old name. Said here so nobody expects
-- the tasks to follow.

begin;

create or replace function app.tg_deliverable_name_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;
  -- Migrations and seeders, and definer functions that stamp names (attach, the wizard).
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if length(trim(new.name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if old.owner_user_id = auth.uid()
     or app.deliverable_account_manager(old.id) = auth.uid()
     or (app.has_permission('project_tasks', 'manage')
         and app.in_write_scope(old.department_id, null, app.deliverable_account_manager(old.id))) then
    return new;
  end if;
  raise exception
    'renaming this deliverable is outside your reach — its owner, its department''s leads or the account manager can'
    using errcode = '42501';
end $$;

comment on function app.tg_deliverable_name_guard() is
  'I52.13: who may rename a deliverable — its owner, the campaign''s account manager, or '
  'project_tasks:manage within reach of its department. Held in Postgres so a PATCH and '
  'public.rename_deliverable are governed identically (ADR-0037). A blank name is refused.';

drop trigger if exists deliverable_name_guard on deliverables;
create trigger deliverable_name_guard
  before update of name on deliverables
  for each row execute function app.tg_deliverable_name_guard();

-- SECURITY INVOKER: RLS and the trigger decide.
create or replace function public.rename_deliverable(p_deliverable uuid, p_name text)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  update deliverables set name = trim(p_name) where id = p_deliverable;
  if not found then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
end $$;

comment on function public.rename_deliverable(uuid, text) is
  'I52.13: the supported way to rename a deliverable. Adds no authority — app.tg_deliverable_name_guard '
  'decides. Task titles composed from the old name are NOT rewritten (ADR-0052 d.14).';

revoke execute on function public.rename_deliverable(uuid, text) from public;
revoke execute on function public.rename_deliverable(uuid, text) from anon;
grant  execute on function public.rename_deliverable(uuid, text) to authenticated;

commit;
