-- I59.21 (ADR-0107, accepted 25 Sep) — a maker says what blocks them, on their own task, and the
-- blocked time is not theirs. The schema, the rights, the reader and the "I'm blocked" notice; the
-- subtraction itself runs in app.sub_task_submit (`20260926102000`).
--
--   d.1  `deliverable_pending_inputs.sub_task_id` (nullable). With it, an input applies to THAT task
--        only; without it, it cascades to every task on the deliverable exactly as ADR-0069 d.7 has
--        it. The task must belong to the input's deliverable (a trigger — `sub_tasks` has no
--        (id, deliverable_id) key to point a composite FK at, and adding one to a table this central
--        for one check is the bigger change). `kind` — the Figma's five (copy · the client · a file ·
--        a decision · something else) — nullable, because every existing row predates it.
--        `description` stays NOT NULL (ADR-0069 d.7) and `awaited_from` stays free text (d.8).
--
--   d.2  The task's ASSIGNEE may raise one on their OWN task (description and awaited_from both
--        required), and the assignee or the deliverable's OWNER may clear it — besides
--        project_tasks:manage, which keeps every right it had (`deliverable_pending_inputs_manage_write`
--        is untouched). Neither new audience may change anything else on the row, and because the
--        blocked minutes come off the maker's recorded time (d.3), the two stamps that measure it are
--        the server's, not the caller's: for them, `requested_at` is now() on insert and never moves,
--        and a clear stamps `satisfied_at` = now(). A manager's row is written as before.
--        Raising one tells the deliverable's owner and its account manager (`task_blocked`).
--
--   d.3  `task_time_entries.blocked_minutes` — how much of the round the task's own inputs held it.
--        Null on rows written before this (not measured); app.task_blocked_minutes computes it as the
--        UNION of the input intervals, so two overlapping blocks count once.
--
-- READERS of `deliverable_pending_inputs`, checked 25 Sep (grep over supabase/migrations and src/):
--   * app.sub_task_has_unmet_prereqs — reproduced whole below: a task-level input counts for its own
--     task only. Its callers inherit that: app.sub_task_start (`started_ahead`) and
--     app.notify_dependents_ready (ADR-0069 d.4, the "you can start" notice) — neither re-emitted,
--     they only call the predicate.
--   * Frontend piece-level readers (campaign-risk-api, campaign-pulse-api, outstanding-inputs-api,
--     requirements-api) — read per DELIVERABLE; out of this track's scope, listed in the report.
-- The audit trigger on the table (20260819160000) stays; nothing here removes it.

begin;

-- ------------------------------------------------------------------ d.1 the columns ----
alter table deliverable_pending_inputs
  add column if not exists sub_task_id uuid references sub_tasks(id) on delete cascade,
  add column if not exists kind text
    constraint chk_deliverable_pending_inputs_kind
    check (kind is null or kind in ('copy', 'client', 'file', 'decision', 'other'));

create index if not exists idx_deliverable_pending_inputs_sub_task
  on deliverable_pending_inputs (sub_task_id) where sub_task_id is not null;

comment on column deliverable_pending_inputs.sub_task_id is
  'ADR-0107 d.1: set = this input applies to THIS task only (a maker''s "I''m blocked"); null = it '
  'cascades to every task on the deliverable (ADR-0069 d.7). Must be a task of the same deliverable.';
comment on column deliverable_pending_inputs.kind is
  'ADR-0107 d.2: what is missing — copy · client · file · decision · other. Null on rows raised '
  'before 25 Sep.';

alter table task_time_entries
  add column if not exists blocked_minutes numeric(7,1);

comment on column task_time_entries.blocked_minutes is
  'ADR-0107 d.3: minutes of this round during which the task''s OWN inputs (sub_task_id = the task) '
  'were outstanding — the union of [requested_at, satisfied_at or send] clipped to [started_at, '
  'send], overlaps counted once. Already subtracted from `minutes` on a timed round. Null = written '
  'before ADR-0107 (not measured).';

-- ------------------------------------------------ d.1 / d.2 the row guard ----
-- Same deliverable; and for a caller WITHOUT project_tasks:manage (the assignee, the owner) only
-- satisfied_at may change, and the stamps are the server's. Fixtures and migrations (no auth.uid())
-- are left alone, as every guard in this schema does.
create or replace function app.tg_pending_input_task_guard()
returns trigger language plpgsql
set search_path = public, app as $$
declare v_manager boolean;
begin
  if new.sub_task_id is not null and not exists (
    select 1 from sub_tasks st
     where st.id = new.sub_task_id and st.deliverable_id = new.deliverable_id
  ) then
    raise exception 'that task is not on this deliverable' using errcode = '23514';
  end if;

  if auth.uid() is null then
    return new;
  end if;
  v_manager := app.has_permission('project_tasks', 'manage');
  if v_manager then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.requested_at := now();
    new.created_by   := auth.uid();
    new.satisfied_at := null;
    return new;
  end if;

  -- UPDATE by the assignee or the owner: clearing (or re-opening) is all they may do.
  if new.deliverable_id is distinct from old.deliverable_id
     or new.sub_task_id  is distinct from old.sub_task_id
     or new.description  is distinct from old.description
     or new.awaited_from is distinct from old.awaited_from
     or new.kind         is distinct from old.kind
     or new.requested_at is distinct from old.requested_at
     or new.created_by   is distinct from old.created_by
     or new.tenant_id    is distinct from old.tenant_id then
    raise exception 'only clearing a block is open to you here — ask the deliverable''s owner to change it'
      using errcode = '42501';
  end if;
  if new.satisfied_at is not null and old.satisfied_at is null then
    new.satisfied_at := now();
  end if;
  return new;
end $$;

comment on function app.tg_pending_input_task_guard() is
  'ADR-0107 d.1/d.2: a task-level input names a task of its own deliverable; a caller without '
  'project_tasks:manage (the assignee raising, the assignee or owner clearing) changes nothing but '
  'satisfied_at, and requested_at / satisfied_at are stamped now() — they measure the blocked '
  'minutes subtracted from the maker''s time.';

drop trigger if exists pending_input_task_guard on deliverable_pending_inputs;
create trigger pending_input_task_guard
  before insert or update on deliverable_pending_inputs
  for each row execute function app.tg_pending_input_task_guard();

-- ------------------------------------------------------------------ d.2 the rights ----
create policy deliverable_pending_inputs_assignee_insert on deliverable_pending_inputs
  for insert to authenticated
  with check (
    tenant_id = app.current_tenant_id()
    and sub_task_id is not null
    and nullif(btrim(description), '') is not null
    and nullif(btrim(awaited_from), '') is not null
    and exists (
      select 1 from sub_tasks st
       where st.id = sub_task_id
         and st.deliverable_id = deliverable_pending_inputs.deliverable_id
         and st.tenant_id = app.current_tenant_id()
         and st.assignee_id = auth.uid()
    )
  );

create policy deliverable_pending_inputs_task_people_update on deliverable_pending_inputs
  for update to authenticated
  using (
    tenant_id = app.current_tenant_id()
    and sub_task_id is not null
    and (
      exists (select 1 from sub_tasks st
               where st.id = sub_task_id and st.assignee_id = auth.uid())
      or exists (select 1 from deliverables d
                  where d.id = deliverable_id and d.owner_user_id = auth.uid())
    )
  )
  with check (
    tenant_id = app.current_tenant_id()
    and sub_task_id is not null
    and (
      exists (select 1 from sub_tasks st
               where st.id = sub_task_id and st.assignee_id = auth.uid())
      or exists (select 1 from deliverables d
                  where d.id = deliverable_id and d.owner_user_id = auth.uid())
    )
  );

-- ------------------------------------------------ the predicate, reproduced whole ----
-- From 20260903110100 (its latest definition; checked). The one edit is marked.
create or replace function app.sub_task_has_unmet_prereqs(p_sub_task uuid)
returns boolean language sql stable set search_path = public, app as $$
  select exists (
    select 1 from sub_task_dependencies dep
    join sub_tasks a on a.id = dep.depends_on_sub_task_id
    -- ADR-0069 d.2: `review` no longer satisfies. Only accepted work, or work that will never
    -- happen, releases what is waiting on it.
    where dep.sub_task_id = p_sub_task and a.status not in ('done', 'cancelled')
  ) or exists (
    select 1 from deliverable_pending_inputs pin
    join sub_tasks st on st.deliverable_id = pin.deliverable_id
    where st.id = p_sub_task and pin.satisfied_at is null
      -- ADR-0107 d.1: an input on ONE task holds that task only; one on the deliverable cascades.
      and (pin.sub_task_id is null or pin.sub_task_id = st.id)
  )
$$;

comment on function app.sub_task_has_unmet_prereqs(uuid) is
  'ADR-0030 as amended by ADR-0069 d.2 and ADR-0107 d.1: true if the sub-task has a dependency not '
  'yet APPROVED, OR an outstanding external input — one on its deliverable (cascading) or one on '
  'this task itself. Another task''s own input does not count. Still SOFT — never gates.';

-- ------------------------------------------------------------ d.3 the blocked minutes ----
create or replace function app.task_blocked_minutes(p_sub_task uuid, p_from timestamptz, p_to timestamptz)
returns numeric language sql stable set search_path = public, app as $$
  select case
    when p_from is null or p_to is null or p_to <= p_from then 0::numeric
    else coalesce((
      select round((sum(extract(epoch from (upper(r) - lower(r)))) / 60.0)::numeric, 1)
        from unnest(
          (select range_agg(tstzrange(pin.requested_at, coalesce(pin.satisfied_at, p_to), '[)'))
             from deliverable_pending_inputs pin
            where pin.sub_task_id = p_sub_task
              and coalesce(pin.satisfied_at, p_to) > pin.requested_at)
          * tstzmultirange(tstzrange(p_from, p_to, '[)'))
        ) as r
    ), 0::numeric)
  end
$$;

comment on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) is
  'ADR-0107 d.3: minutes within [p_from, p_to) during which the task''s OWN inputs were outstanding '
  '(requested_at to satisfied_at, or to p_to while open) — the UNION, so overlapping blocks count '
  'once. Deliverable-level inputs are not counted (see the report / Questions for Edward).';

revoke execute on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) from public, anon;
grant  execute on function app.task_blocked_minutes(uuid, timestamptz, timestamptz) to authenticated;

-- ------------------------------------------------------ d.2 the owner and the AM are told ----
create or replace function app.tg_pending_input_notify_blocked()
returns trigger language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks; v_owner uuid; v_am uuid;
begin
  if new.sub_task_id is null then
    return null;                      -- a deliverable-level input is ADR-0069's, unchanged
  end if;
  select * into v from sub_tasks where id = new.sub_task_id;
  select d.owner_user_id into v_owner from deliverables d where d.id = new.deliverable_id;
  v_am := app.deliverable_account_manager(new.deliverable_id);

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select new.tenant_id, r.user_id, 'task_blocked', v.title, 'sub_task', v.id, auth.uid(),
         jsonb_build_object(
           'task', v.title, 'task_id', v.id, 'deliverable_id', new.deliverable_id,
           'input_id', new.id, 'kind', new.kind, 'awaited_from', new.awaited_from,
           'description', new.description, 'maker_id', v.assignee_id)
    from (select distinct u as user_id from unnest(array[v_owner, v_am]) as u) r
   where r.user_id is not null
     and r.user_id is distinct from auth.uid();     -- never tell the actor about their own act
  return null;
end $$;

comment on function app.tg_pending_input_notify_blocked() is
  'ADR-0107 d.2: a task-level input (a maker''s "I''m blocked") tells the deliverable''s owner and '
  'its account manager — once each, never the person who raised it. type task_blocked; detail '
  'carries task, kind, awaited_from, description.';

drop trigger if exists pending_input_notify_blocked on deliverable_pending_inputs;
create trigger pending_input_notify_blocked
  after insert on deliverable_pending_inputs
  for each row execute function app.tg_pending_input_notify_blocked();

commit;
