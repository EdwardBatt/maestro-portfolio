-- ADR-0042 (I13.1): the assets a task needs are held on the TASK.
--
-- WHAT WAS MISSING. A booking is always a booking *of* a resource, and that half has worked since
-- 28 July. The other direction — "task A needs the RED camera" — had no model at all. It was
-- expressible only by accident: a `bookings` row carries both `resource_id` and `sub_task_id`, and
-- nothing constrains that resource to be human, so pointing a camera booking at a task was the only
-- way to say it. Then the scheduler destroyed it. `subtask-schedule` releases by
-- `delete from bookings where sub_task_id = <task>` — every booking, whatever resource it sits on —
-- and re-creates only on the assignee's own resource, so the camera vanished on any reassignment,
-- date change or hours change: exactly the operations the scheduling flow performs.
--
-- WHAT THIS MIGRATION ADDS is the record itself (ADR-0042 d.1) plus the one invariant change that
-- record forces (d.5). The scheduler that materialises from it, and the screen that edits it, are
-- the other halves of I13.1 and land separately — this file is safe on its own: a table nothing
-- writes to yet changes nothing, and the span narrowing is correct with or without it.
--
-- search_path pinned inline per ADR-0033.

begin;

-- ============================================================================
-- 1) same-tenant anchors for the composite FKs below
-- ============================================================================
-- `resource_id uuid references resources(id)` alone does NOT stop a row pointing at ANOTHER
-- tenant's camera — the FK does not know about tenants, and an RLS `with check` only ever sees the
-- row being written, so it would have to go looking. A composite FK on (tenant_id, <id>) makes
-- Postgres enforce it, for every writer, forever — which is where an invariant belongs
-- (AGENTS.md §2). Both columns are already `not null`, so each unique is a plain btree index.
alter table sub_tasks add constraint uq_sub_tasks_tenant_id_id unique (tenant_id, id);
alter table resources add constraint uq_resources_tenant_id_id unique (tenant_id, id);

-- ============================================================================
-- 2) sub_task_resources
-- ============================================================================
create table sub_task_resources (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  sub_task_id  uuid not null,
  resource_id  uuid not null,
  -- How long the ASSET is needed for, which is not the task's span: a camera wanted for 2 days of a
  -- 5-day shoot occupies 2 days (ADR-0042 d.3).
  days         integer not null check (days >= 1),
  -- Pins the requirement to a date. Null means "the task's first day" and lets the scheduler place
  -- it, which is what a template will write.
  starts_on    date,
  notes        text,
  created_by   uuid references user_profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- One row per resource per task. Every resource has its own id, so Camera A and Camera B are
  -- different rows and a task needing two cameras names two (ADR-0042 d.1) — there is deliberately
  -- no type-and-quantity concept to be ambiguous about which camera.
  constraint uq_sub_task_resources_task_resource unique (sub_task_id, resource_id),
  constraint fk_sub_task_resources_sub_task
    foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id) on delete cascade,
  constraint fk_sub_task_resources_resource
    foreign key (tenant_id, resource_id) references resources (tenant_id, id)
);

create index idx_sub_task_resources_tenant_id on sub_task_resources (tenant_id);
create index idx_sub_task_resources_sub_task_id on sub_task_resources (sub_task_id);
create index idx_sub_task_resources_resource_id on sub_task_resources (resource_id);

comment on table sub_task_resources is
  'ADR-0042: the resources a task NEEDS — the other direction from a booking, which is a booking OF '
  'a resource. Independent of any calendar entry, so releasing or rebuilding a schedule no longer '
  'destroys the requirement. A resource here may be a PERSON ("task A also needs Sara for two '
  'days"): that is additional resource on the task, not a second assignee — sub_tasks.assignee_id '
  'is a single column and the task keeps exactly one owner.';
comment on column sub_task_resources.days is
  'ADR-0042 d.3: how long the ASSET is needed, not the task''s span.';
comment on column sub_task_resources.starts_on is
  'ADR-0042 d.3: pins the requirement to a date; null = the task''s first day.';

-- ============================================================================
-- 3) who may write a requirement: whoever may manage the task
-- ============================================================================
-- ADR-0042 d.1 gates writes on "the same authority that edits the task itself", which is the
-- sub_tasks manage predicate: project_tasks:manage AND the task's write scope, or the appointed PM
-- (ADR-0029, project-scoped across departments).
--
-- The ONE branch deliberately not carried over is `assignee_id = auth.uid()`. That branch exists on
-- sub_tasks so an assignee can PROGRESS their own task (start it, submit it) — its own comment in
-- 20260819100000 says "Team Member has no manage path here". Deciding a task needs the RED camera
-- is management, not progress.
--
-- SECURITY INVOKER on purpose: it reads sub_tasks, which every caller may already select
-- tenant-wide, so it needs no elevation and gets none (AGENTS.md — definer needs an ADR).
create or replace function app.can_manage_sub_task(p_sub_task uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select exists (
    select 1
    from public.sub_tasks st
    where st.id = p_sub_task
      and st.tenant_id = app.current_tenant_id()
      and (
        (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(st.department_id, st.team_id,
                                 app.deliverable_account_manager(st.deliverable_id)))
        or app.caller_is_project_pm(st.deliverable_id)
      )
  )
$$;
comment on function app.can_manage_sub_task(uuid) is
  'ADR-0042: may the caller MANAGE this task (not merely progress it)? project_tasks:manage + the '
  'task''s write scope, or the appointed project PM. Mirrors the sub_tasks manage policies minus '
  'their assignee self-branch, which is a progress path, not a management one.';

alter table sub_task_resources enable row level security;
alter table sub_task_resources force row level security;

-- Reads are tenant-wide, exactly as sub_tasks itself is: what a job needs is not sensitive, and the
-- schedule has to show it to everyone who can see the work.
create policy sub_task_resources_tenant_select on sub_task_resources
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create policy sub_task_resources_manage_insert on sub_task_resources
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

-- USING and WITH CHECK both, and both on the row's own sub_task_id: without the WITH CHECK half a
-- caller who may manage task X could move a requirement onto task Y they may not touch.
create policy sub_task_resources_manage_update on sub_task_resources
  for update to authenticated
  using      (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id))
  with check (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

create policy sub_task_resources_manage_delete on sub_task_resources
  for delete to authenticated
  using (tenant_id = app.current_tenant_id() and app.can_manage_sub_task(sub_task_id));

create trigger set_updated_at before update on sub_task_resources
  for each row execute function app.set_updated_at();
create trigger audit_row_change
  after insert or update or delete on sub_task_resources
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 4) the task's span comes from the ASSIGNEE's bookings only (ADR-0042 d.5)
-- ============================================================================
-- ADR-0039 made a task's dates the envelope of ALL its bookings. Once a task can require a camera,
-- that envelope is wrong: book the camera on the one day it is free — the Tuesday after the shoot —
-- and the task's deadline silently moves out with it. A deadline must move only because a person
-- moved it (ADR-0042 d.6, "conflict raised, discussed and resolved"), so the envelope narrows to
-- the bookings that represent the assignee actually doing the work.
--
-- The assignee's bookings are those on a resource mapped to them (`resources.user_id`), which is how
-- ADR-0011 provisions every internal user.
--
-- CONSEQUENCE, ACCEPTED: a task with NO assignee no longer takes dates from its bookings — there is
-- no assignee whose bookings could form the envelope. It keeps the dates it was given, which is the
-- same answer ADR-0039 d.3 already gives an unscheduled task ("unscheduled is not undated") and the
-- safe direction: nothing silently erases or moves a deadline. In practice the case is rare, because
-- `subtask-schedule` books on the assignee's own resource and therefore only runs on assigned work.
create or replace function app.sync_subtask_span(p_sub_task uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_start timestamptz;
  v_end   timestamptz;
begin
  select min(b.starts_at), max(b.ends_at)
    into v_start, v_end
  from public.bookings b
  join public.sub_tasks st on st.id = p_sub_task
  join public.resources  r on r.id  = b.resource_id
  where b.sub_task_id = p_sub_task
    and b.state <> 'cancelled'          -- a cancelled booking is not when the work happens
    and st.assignee_id is not null
    and r.user_id = st.assignee_id;     -- ADR-0042 d.5: the assignee's own bookings, not an asset's

  -- An unscheduled task is not a task with no deadline (ADR-0039 d.3): with no live bookings the
  -- task keeps the dates it was given, so releasing a schedule never silently erases a due date.
  if v_start is null then
    return;
  end if;

  update public.sub_tasks
     set starts_at = v_start,
         due_at    = v_end
   where id = p_sub_task
     and (starts_at is distinct from v_start or due_at is distinct from v_end);
end $$;

comment on function app.sync_subtask_span(uuid) is
  'ADR-0039, narrowed by ADR-0042 d.5: set a task''s span to the envelope of the ASSIGNEE''s live '
  'bookings (earliest start, latest end). A resource required BY the task — a camera, or a second '
  'person — is booked for its own days and can never move or stretch the task''s dates. No live '
  'assignee bookings leaves the task''s dates alone: unscheduled is not undated.';

commit;
