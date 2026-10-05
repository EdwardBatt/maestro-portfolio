-- I44 (ADR-0090, amended 12 Sep) — the account manager does not approve the task list.
--
-- WHERE RESPONSIBILITY BELONGS. The account manager approves the CAMPAIGN (ADR-0048 d.8) — that is
-- the whole of their authority over the work, and it is where it ends. What happens next belongs to
-- the people who will do it: the Department Manager OWNS the deliverable, approves its task list,
-- and assigns it to one of their team leads. A single job's task-list approval is the department's
-- acceptance of the work (ADR-0090 d.4), so it must be answered by the department, not by the
-- manager who handed the work over. We are enforcing accountability where the responsibility sits:
-- the person who signs off the list is the person who owns delivering it.
--
-- WHAT THIS CHANGES. `20260911130600` passed the deliverable's account manager into the scope check
-- (`app.deliverable_account_manager(v.id)`), which let the campaign's AM approve the task list on
-- their own job through the ACCOUNT branch of `app.in_write_scope`. That was added on review as a
-- null-argument "fix" (traps.md) — but it grants the AM an authority the flow never intended. This
-- migration removes it: the account branch is no longer offered to this gate. The AM keeps
-- `deliverable_owner:manage` for what it is actually for — reassigning a deliverable's owner on
-- their campaign (`20260828120000`) — but that grant no longer reaches task-list approval.
--
-- WHO MAY APPROVE, AFTER THIS (ADR-0090 d.4, amended):
--   * the OWNER of record — the Department Manager on the deliverable;
--   * anyone with `deliverable_owner:manage` within the DEPARTMENT's own scope — a lead in that
--     department (the team branch of `in_write_scope`), and Power Admin / Traffic Manager, who pass
--     by being tenant-scoped. That tenant reach is the FAILSAFE for an absent owner and it stays.
--   * NOT the account manager, who no longer passes on the account branch.
-- Computed from the row and from grants; no role is named (ADR-0073/0074).
--
-- SINGLE SOURCE OF TRUTH. The authority predicate is extracted into
-- `app.may_approve_deliverable_tasks(deliverables)`. The RPC raises on it, and a PostgREST computed
-- column `public.can_approve_tasks(deliverables)` exposes the SAME answer to the client, so the
-- "Approve task list" button is offered to exactly whom the RPC will admit and can never drift from
-- it — the UI no longer guesses from an unscoped grant check (found 12 Sep: the button was offered
-- to any `deliverable_owner:manage` holder and dead-ended for those the RPC refuses).

begin;

-- ---------------------------------------------------------------- the predicate ----
-- The one reading of "may this caller approve this deliverable's task list" (ADR-0090 d.4, amended).
-- Reads only the row it is given and the caller's grants/scope through the existing definer helpers;
-- names no role. The account-manager argument is deliberately NOT passed to in_write_scope here — a
-- single job's list is the department's to accept, not the AM's.
create or replace function app.may_approve_deliverable_tasks(v public.deliverables)
returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select
       (v.owner_user_id is not null and v.owner_user_id = auth.uid())
    or (app.has_permission('deliverable_owner', 'manage')
        and app.in_write_scope(v.department_id, null, null));
$$;

comment on function app.may_approve_deliverable_tasks(public.deliverables) is
  'ADR-0090 d.4 (amended 12 Sep): may the caller approve this deliverable''s task list. The owner '
  'of record, or deliverable_owner:manage within the deliverable''s department scope (incl. the '
  'tenant-scoped failsafe). NOT the account manager — the account branch is not offered: the AM '
  'approves the campaign, the department owns and accepts the list. One predicate, used by both '
  'approve_deliverable_tasks and the can_approve_tasks computed column so the UI cannot drift.';

revoke execute on function app.may_approve_deliverable_tasks(public.deliverables) from public, anon;
grant  execute on function app.may_approve_deliverable_tasks(public.deliverables) to authenticated;

-- ---------------------------------------------------------------- the RPC ----
-- Reproduced whole from `20260911130600`, its last definition. The ONLY change is the authority
-- line, which now defers to the predicate above; the not-found guard, the idempotency return and
-- the app.task_list_approval GUC fence (so only this door writes the two columns) are byte-identical.
create or replace function public.approve_deliverable_tasks(p_deliverable uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v deliverables;
  v_prior text;
begin
  select * into v from deliverables
   where id = p_deliverable and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;

  -- Idempotent (d.4). The FIRST approval is the fact; a second press must not move the timestamp.
  if v.tasks_approved_at is not null then
    return;
  end if;

  -- d.4 (amended 12 Sep): the owner, or deliverable_owner:manage within the DEPARTMENT's scope —
  -- never the account manager. Enforcing accountability where the responsibility belongs: the AM
  -- approved the campaign; the department owns the list.
  if not app.may_approve_deliverable_tasks(v) then
    raise exception 'only the owner of this deliverable, or someone who may change its owner, can approve its task list'
      using errcode = '42501';
  end if;

  v_prior := coalesce(current_setting('app.task_list_approval', true), '');
  perform set_config('app.task_list_approval', 'on', true);
  update deliverables
     set tasks_approved_at = now(),
         tasks_approved_by = auth.uid()
   where id = p_deliverable;
  perform set_config('app.task_list_approval', v_prior, true);
end $$;

comment on function public.approve_deliverable_tasks(uuid) is
  'ADR-0090 d.4 (amended 12 Sep): the deliverable''s owner — the Department Manager — says "this is '
  'the list", which on a single job is what opens assignment. Authority is app.may_approve_'
  'deliverable_tasks: the owner, or deliverable_owner:manage within the deliverable''s department '
  'scope (incl. the tenant failsafe). The account manager does NOT approve the list. SECURITY '
  'DEFINER because an owner need not hold project_tasks:manage; the app.task_list_approval GUC '
  'fences the two columns it writes. Idempotent — the first timestamp stands.';

-- ---------------------------------------------------------------- the UI's truth ----
-- A PostgREST computed column on deliverables: selecting `can_approve_tasks` tells the client
-- whether THIS caller may approve THIS deliverable's list, from the same predicate the RPC raises
-- on. The "Approve task list" button reads this instead of an unscoped grant check, so it appears
-- only to someone the RPC will admit.
create or replace function public.can_approve_tasks(d public.deliverables)
returns boolean
language sql stable
set search_path = public, app, extensions as $$
  select app.may_approve_deliverable_tasks(d);
$$;

comment on function public.can_approve_tasks(public.deliverables) is
  'PostgREST computed column (ADR-0090 d.4, amended 12 Sep): may the current caller approve this '
  'deliverable''s task list. Mirrors approve_deliverable_tasks exactly via app.may_approve_'
  'deliverable_tasks, so the button offering and the RPC can never disagree.';

revoke execute on function public.can_approve_tasks(public.deliverables) from public, anon;
grant  execute on function public.can_approve_tasks(public.deliverables) to authenticated;

commit;
