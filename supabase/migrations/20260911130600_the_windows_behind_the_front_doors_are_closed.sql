-- From the independent security review, 11 Sep: three rules in this branch were held by an RPC
-- while a table policy left the window open — the ADR-0055 lesson ("an RPC is a front door; the
-- policy decides") repeated. Each is closed here, in Postgres, in the shape this schema already
-- uses: a BEFORE trigger on the column that polices one thing and escapes on `app.system_op`, a
-- superuser path with no actor (migrations, seeders), and a GUC that only the front-door RPC sets.
--
-- 1. deliverables.tasks_approved_at / tasks_approved_by (ADR-0090 d.2 — "server-written only").
--    `deliverables_tenant_write` admits any project_tasks:manage holder tenant-wide and
--    `deliverables_reviewer_update` any reviews:moderate holder, so a bare PATCH forged the owner's
--    approval and opened the assignment gate. Verified by the reviewer as a reviewer-only user and
--    as an out-of-scope department lead. Now: refused unless `app.task_list_approval` is on, which
--    only public.approve_deliverable_tasks sets.
--
-- 2. campaigns.kind (ADR-0086 d.8 "set at creation", d.11 "one way"). `campaigns_tenant_write`
--    has no scope, so a department lead the RPC had refused flipped kind both ways by PATCH — and
--    kind is what tg_sub_task_assignment_gate branches on. Now: a change of kind is refused unless
--    `app.campaign_kind_change` is on, which only public.promote_single_job sets; the one-way rule
--    the RPC holds is therefore the only route.
--
-- 3. sla_events for the deadline record (ADR-0075 d.3, ADR-0088 d.5). `sla_events_tenant_insert`
--    lets any tenant member insert any event_type with themselves as actor, and ADR-0088 derives
--    "pending" from the log — so a team member forged an extension_requested on somebody else's
--    task (past go-live, no validation) that the AM then approved, forged an extension_approved
--    that made a real pending request vanish, and forged a deadline_changed. Now: the six deadline
--    event types are accepted only from a trigger (pg_trigger_depth() > 1 — the two deadline-log
--    triggers), from the four ADR-0088 RPCs (which set `app.sla_event_writer` around their writes,
--    20260911122000), or from a system op. The policy is left as it is: the other event types are
--    written by Edge Functions as the caller (deliverable-transition, booking-transition) and are
--    not this record.
--
-- Also here, from the same review:
--
-- 4. public.approve_deliverable_tasks passed NULL for the account manager to in_write_scope, so
--    the campaign's AM — who holds deliverable_owner:manage and is the person ADR-0055 d.3b names —
--    was refused on their own single job (traps.md, the null-argument trap). Reproduced from
--    20260911130100 with the AM passed, and with the GUC of (1) set around its write.
--
-- 5. The six new public functions that revoked EXECUTE from `anon` without revoking from `public`
--    kept Postgres' default grant. Corrected in their own files (unpushed); nothing to do here.
--
-- FUNCTIONS REPRODUCED HERE, and where each was lifted from (traps.md — the LAST definition):
--   public.approve_deliverable_tasks ← 20260911130100 (only definition)
--   public.promote_single_job        ← 20260911130000 (only definition)
--
-- Tests: 103 (1, 4), 102 (2), 101 (3).

begin;

-- ============================================================================
-- 1) the task-list approval stamp is server-written only
-- ============================================================================
create or replace function app.tg_deliverable_task_list_approval_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.tasks_approved_at is not distinct from old.tasks_approved_at
     and new.tasks_approved_by is not distinct from old.tasks_approved_by then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if coalesce(current_setting('app.task_list_approval', true), '') = 'on' then
    return new;
  end if;
  raise exception
    'a task list is approved through approve_deliverable_tasks, by its owner — the stamp is not editable'
    using errcode = '42501';
end $$;

comment on function app.tg_deliverable_task_list_approval_fence() is
  'ADR-0090 d.2, held by Postgres: tasks_approved_at / tasks_approved_by change only through '
  'public.approve_deliverable_tasks (app.task_list_approval) or a system op. Closes the window '
  'deliverables_tenant_write and deliverables_reviewer_update left beside the RPC (review, 11 Sep).';

create trigger deliverable_task_list_approval_fence
  before update of tasks_approved_at, tasks_approved_by on deliverables
  for each row execute function app.tg_deliverable_task_list_approval_fence();

-- Reproduced from 20260911130100 (its only definition). Two edits: the account manager is passed
-- to in_write_scope (4), and the write is made under the GUC (1).
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

  -- d.4: the owner of record, or the person who could have changed the owner — anyone holding
  -- deliverable_owner:manage within scope of the deliverable (a team lead in that department
  -- passes on the team branch of in_write_scope; the campaign's account manager on the account
  -- branch, which is why the AM is passed and not NULL — traps.md; Power Admin and Traffic
  -- Manager pass by being tenant-scoped, the failsafe for an absent owner). Computed from the row
  -- and from grants; no role is named.
  if not (
       (v.owner_user_id is not null and v.owner_user_id = auth.uid())
    or (app.has_permission('deliverable_owner', 'manage')
        and app.in_write_scope(v.department_id, null, app.deliverable_account_manager(v.id)))
  ) then
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
  'ADR-0090 d.4: the deliverable''s owner says "this is the list", which on a single job is what '
  'opens assignment. Authority: owner_user_id, or deliverable_owner:manage within in_write_scope '
  'of the deliverable''s department or its campaign''s account manager. SECURITY DEFINER because '
  'an owner need not hold project_tasks:manage; the body fixes the two columns it may touch, under '
  'app.task_list_approval. Idempotent — the first timestamp stands.';

revoke execute on function public.approve_deliverable_tasks(uuid) from public;
revoke execute on function public.approve_deliverable_tasks(uuid) from anon;
grant  execute on function public.approve_deliverable_tasks(uuid) to authenticated;

-- ============================================================================
-- 2) a campaign's kind changes only by promotion
-- ============================================================================
create or replace function app.tg_campaign_kind_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.kind is not distinct from old.kind then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if coalesce(current_setting('app.campaign_kind_change', true), '') = 'on' then
    return new;
  end if;
  raise exception
    'a single job becomes a campaign through promote_single_job, and a campaign never becomes a single job'
    using errcode = '42501';
end $$;

comment on function app.tg_campaign_kind_fence() is
  'ADR-0086 d.8/d.11, held by Postgres: campaigns.kind changes only through '
  'public.promote_single_job (app.campaign_kind_change) or a system op. Closes the window '
  'campaigns_tenant_write left beside the RPC (review, 11 Sep).';

create trigger campaign_kind_fence
  before update of kind on campaigns
  for each row execute function app.tg_campaign_kind_fence();

-- Reproduced from 20260911130000 (its only definition). One edit: the write is made under the GUC.
create or replace function public.promote_single_job(p_campaign uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v campaigns;
  v_prior text;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  -- d.11: one way, and a second press is an error rather than a silent success — the modal has just
  -- said "this cannot be undone", and a no-op would make that sentence false in the other direction.
  if v.kind <> 'single_job' then
    raise exception 'this is already a campaign' using errcode = '22023';
  end if;

  -- ADR-0073: hold the grant AND be in scope over the campaign's responsible manager. The assigned
  -- AM passes by their account scope, the Account Director by ADR-0074's reach, Power Admin and
  -- Traffic Manager by being tenant-scoped. No role is named.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_campaign)) then
    raise exception 'promoting this job is outside your scope' using errcode = '42501';
  end if;

  v_prior := coalesce(current_setting('app.campaign_kind_change', true), '');
  perform set_config('app.campaign_kind_change', 'on', true);
  update campaigns set kind = 'campaign'
   where id = p_campaign and tenant_id = app.current_tenant_id();
  perform set_config('app.campaign_kind_change', v_prior, true);
end $$;

comment on function public.promote_single_job(uuid) is
  'ADR-0086 d.10/d.11: a single job becomes a campaign. Sets kind only — the row, its receipt, its '
  'brief, its deliverable and its owner are already there. One way: refused (22023) if it is '
  'already a campaign. projects:manage in scope. The only route past app.tg_campaign_kind_fence.';

revoke execute on function public.promote_single_job(uuid) from public;
revoke execute on function public.promote_single_job(uuid) from anon;
grant  execute on function public.promote_single_job(uuid) to authenticated;

-- ============================================================================
-- 3) the deadline record is written by the system, not by hand
-- ============================================================================
create or replace function app.tg_sla_event_deadline_record_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.event_type not in ('deadline_set', 'deadline_changed',
                            'extension_requested', 'extension_withdrawn',
                            'extension_approved', 'extension_refused') then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;                          -- migrations, seeders, system paths
  end if;
  if pg_trigger_depth() > 1 then
    return new;                          -- raised by a trigger on the task or the deliverable
  end if;
  if coalesce(current_setting('app.sla_event_writer', true), '') = 'on' then
    return new;                          -- the four ADR-0088 RPCs
  end if;
  raise exception
    'the deadline record is written by the system — ask for an extension rather than writing one'
    using errcode = '42501';
end $$;

comment on function app.tg_sla_event_deadline_record_fence() is
  'ADR-0075 d.3 + ADR-0088 d.5, held by Postgres: deadline_set, deadline_changed and the four '
  'extension_* events are accepted only from a trigger, from the ADR-0088 RPCs '
  '(app.sla_event_writer) or from a system op. sla_events_tenant_insert admitted any actor with '
  'any payload, and "pending" is derived from this log (review, 11 Sep).';

create trigger sla_event_deadline_record_fence
  before insert on sla_events
  for each row execute function app.tg_sla_event_deadline_record_fence();

commit;
