-- ADR-0030 (I8.3): soft dependencies, external inputs, started-ahead; drop `blocked` from sub-tasks.
--
-- Blocking is removed as a sub-task status (it rewards idleness). Waiting is modelled as information:
-- a sub-task may DEPEND ON another (soft, cross-deliverable, cycle-guarded), and a deliverable may
-- carry SPECIFIC external-input items that cascade to its sub-tasks. Neither gates work — Start is
-- never disabled. Starting a task while a dependency/input is unsatisfied flags the time entry
-- `started_ahead` (initiative; rework is tracked separately by rounds). Visible now; consequences P2.

-- ---- drop `blocked` from the sub-task status set (dependencies replace it) ----
update sub_tasks set status = 'in_progress' where status = 'blocked';   -- none expected; safety
alter table sub_tasks drop constraint if exists sub_tasks_status_check;
alter table sub_tasks add constraint sub_tasks_status_check
  check (status in ('todo', 'in_progress', 'review', 'done', 'cancelled'));

-- ---- internal dependencies: B depends on A (soft; cross-deliverable; cycle-guarded) ----
create table sub_task_dependencies (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references tenants(id),
  sub_task_id            uuid not null references sub_tasks(id) on delete cascade,   -- B (the dependent)
  depends_on_sub_task_id uuid not null references sub_tasks(id) on delete cascade,   -- A (the prerequisite)
  created_at             timestamptz not null default now(),
  constraint chk_sub_task_dep_not_self check (sub_task_id <> depends_on_sub_task_id),
  unique (sub_task_id, depends_on_sub_task_id)
);
create index idx_sub_task_dep_sub_task on sub_task_dependencies (sub_task_id);
create index idx_sub_task_dep_prereq   on sub_task_dependencies (depends_on_sub_task_id);

-- reject an edge that would create a cycle (A already transitively depends on B)
create or replace function app.tg_sub_task_dep_no_cycle() returns trigger
language plpgsql set search_path = public, app as $$
begin
  if exists (
    with recursive chain as (
      select depends_on_sub_task_id as node from sub_task_dependencies where sub_task_id = new.depends_on_sub_task_id
      union
      select d.depends_on_sub_task_id from sub_task_dependencies d join chain c on d.sub_task_id = c.node
    )
    select 1 from chain where node = new.sub_task_id
  ) then
    raise exception 'sub-task dependency would create a cycle' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger sub_task_dep_no_cycle before insert on sub_task_dependencies
  for each row execute function app.tg_sub_task_dep_no_cycle();

alter table sub_task_dependencies enable row level security;
alter table sub_task_dependencies force row level security;
create policy sub_task_dependencies_tenant_select on sub_task_dependencies
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy sub_task_dependencies_manage_write on sub_task_dependencies
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'));
create trigger audit_row_change after insert or update or delete on sub_task_dependencies
  for each row execute function app.audit_row_change();

-- ---- external inputs: specific, deliverable-level, cascade to its sub-tasks ----
create table deliverable_pending_inputs (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  description    text not null,                              -- SPECIFIC ("Acme logo pack"), never a vague "blocked"
  awaited_from   text,                                       -- who it's expected from (free text for now)
  requested_at   timestamptz not null default now(),
  satisfied_at   timestamptz,                                -- null = still outstanding
  created_by     uuid references user_profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_deliverable_pending_inputs_deliverable on deliverable_pending_inputs (deliverable_id);
alter table deliverable_pending_inputs enable row level security;
alter table deliverable_pending_inputs force row level security;
create policy deliverable_pending_inputs_tenant_select on deliverable_pending_inputs
  for select to authenticated using (tenant_id = app.current_tenant_id());
create policy deliverable_pending_inputs_manage_write on deliverable_pending_inputs
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('project_tasks', 'manage'));
create trigger set_updated_at before update on deliverable_pending_inputs
  for each row execute function app.set_updated_at();
create trigger audit_row_change after insert or update or delete on deliverable_pending_inputs
  for each row execute function app.audit_row_change();

-- ---- has this sub-task any unmet prerequisite (dependency not submitted, or an outstanding input)? ----
create or replace function app.sub_task_has_unmet_prereqs(p_sub_task uuid)
returns boolean language sql stable set search_path = public, app as $$
  select exists (
    select 1 from sub_task_dependencies dep
    join sub_tasks a on a.id = dep.depends_on_sub_task_id
    where dep.sub_task_id = p_sub_task and a.status not in ('review', 'done', 'cancelled')
  ) or exists (
    select 1 from deliverable_pending_inputs pin
    join sub_tasks st on st.deliverable_id = pin.deliverable_id
    where st.id = p_sub_task and pin.satisfied_at is null
  )
$$;
comment on function app.sub_task_has_unmet_prereqs(uuid) is
  'ADR-0030: true if the sub-task has a dependency not yet submitted OR its deliverable has an outstanding external input. Soft — never gates; drives the started_ahead flag.';

-- ---- amend Start to flag "started ahead" when a prerequisite is unmet ----
create or replace function app.sub_task_start(p_id uuid)
returns void language plpgsql security definer set search_path = public, app as $$
declare v sub_tasks;
begin
  select * into v from sub_tasks where id = p_id;
  if v.id is null then raise exception 'sub_task % not found', p_id using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the assignee may start this task' using errcode = '42501';
  end if;
  if v.status <> 'todo' then
    raise exception 'task can only be started from todo (is %)', v.status using errcode = '22023';
  end if;
  update sub_tasks set status = 'in_progress' where id = p_id;
  insert into task_time_entries (tenant_id, sub_task_id, user_id, round, started_at, mode, started_ahead)
  values (v.tenant_id, p_id, auth.uid(), v.revision_number, now(), 'timer', app.sub_task_has_unmet_prereqs(p_id));
end $$;
