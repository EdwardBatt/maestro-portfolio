-- I19.4 / I19.5 (ADR-0052 d.5, d.6) — giving a deliverable a type lays out its work.
--
-- **The automatic caller is a TRIGGER, not an RPC, and that is the whole point.** A plain
-- `PATCH /deliverables?id=eq.… {"deliverable_type_id": "…"}` calls no RPC. An RPC-only design would
-- have set the type and silently created nothing — precisely the failure ADR-0048 d.8 records about
-- ADR-0043's reviewer rule, where the check lived in a function and a plain table update walked
-- round it.
--
-- It also means `create_campaign_from_brief` needs no change, which is the other half of the point.
-- It inserts a deliverables row per line; now that the wizard passes a type (ADR-0051), the
-- `after insert` branch fires per row and a campaign arrives with every deliverable's task list
-- already laid out for the Account Manager to read before approving. An RPC design would have
-- needed that function edited — and would have been forgotten by the next function that inserts a
-- deliverable.
--
-- `security definer` (AGENTS.md §6), and the bypass is justified three ways:
--
--   * **Authorisation happened one level up.** To reach this trigger you were already allowed to
--     insert or update that `deliverables` row. Creating the tasks is a mechanical consequence of
--     an authorised act — the same shape as `app.tg_deliverable_stamp_department` stamping a
--     department as a consequence of naming an owner.
--   * **What it writes cannot hurt anyone.** The rows are unassigned, unbooked and unreviewed. They
--     consume no capacity, name nobody, and cannot pass the campaign approval gate or reach review
--     until a human assigns them through the ordinary, fully-checked path.
--   * **Invoker rights would refuse callers who are plainly entitled.** `sub_tasks_manage_insert`
--     requires `app.in_write_scope`, and an Account Manager who does not hold `project_tasks:manage`
--     would find campaign creation itself failing — for tasks nobody can act on yet.
--
-- `sla_hours` is left NULL. It is never given `default_hours`: `sla_hours` is tier 1 of
-- `app.effective_sla` ("manual leaf override — beats everything"), so writing a template estimate
-- there would short-circuit every tier beneath it on every materialised task, including the
-- deliverable-type and department tiers ADR-0053 exists to add. The step default is offered as a
-- PREFILL at assignment instead.

begin;

create or replace function app.materialise_deliverable_workflow(
  p_deliverable uuid,
  p_template uuid default null
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_created  integer;
begin
  select d.tenant_id, d.department_id,
         coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_template
    from deliverables d
    left join deliverable_types dt on dt.id = d.deliverable_type_id
   where d.id = p_deliverable;

  if v_tenant is null or v_template is null then
    return 0;
  end if;

  -- Fenced to the caller's own tenant. `p_template` is an argument, so a template id from another
  -- tenant must be refused here rather than trusted — this function is definer-rights and RLS is
  -- not doing it for us.
  if not exists (select 1 from workflow_templates wt
                  where wt.id = v_template and wt.tenant_id = v_tenant) then
    raise exception 'that workflow template is not in your organization' using errcode = '22023';
  end if;

  -- d.6: adds what is missing, never duplicates. `workflow_step_id` is what makes this idempotent —
  -- re-running after a template gains a step creates only the new one, and a task somebody has
  -- since renamed or re-dated is left exactly as it is.
  insert into sub_tasks (
    tenant_id, deliverable_id, title, description, department_id,
    status, sort_order, workflow_step_id, created_by
  )
  select
    v_tenant, p_deliverable, ws.title_en, ws.description_en,
    -- The deliverable's own department, derived from its owner by ADR-0050. NOT from the template:
    -- a template names work, never an organisational unit, and this is the line that keeps that
    -- true once the work becomes real rows.
    v_dept,
    'todo', ws.sort_order, ws.id, auth.uid()
  from workflow_steps ws
  where ws.tenant_id = v_tenant
    and ws.template_id = v_template
    and ws.is_active
    and not exists (
      select 1 from sub_tasks st
       where st.deliverable_id = p_deliverable and st.workflow_step_id = ws.id
    )
  order by ws.sort_order;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function app.materialise_deliverable_workflow(uuid, uuid) is
  'ADR-0052 d.5/d.6: create one unassigned sub-task per active step of a deliverable''s workflow '
  'template, skipping steps that already have one. Returns how many were created. Idempotent by '
  'sub_tasks.workflow_step_id, so re-running adds only what is missing and never duplicates.';

-- ------------------------------------------------------------------- the trigger ----
create or replace function app.tg_deliverable_materialise_workflow() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  -- Only when a type is newly set. Clearing a type leaves the tasks alone — work already laid out
  -- is work somebody may already be doing, and d.6 says changing a type never deletes.
  if new.deliverable_type_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.deliverable_type_id is not distinct from new.deliverable_type_id then
    return null;
  end if;

  perform app.materialise_deliverable_workflow(new.id);
  return null;
end $$;

comment on function app.tg_deliverable_materialise_workflow() is
  'ADR-0052 d.5: the automatic caller. A TRIGGER rather than an RPC, because a plain PostgREST '
  'PATCH setting deliverable_type_id calls no RPC — and an RPC-only design would have set the type '
  'and silently created no work at all.';

-- AFTER: the deliverable row must exist before its tasks can reference it, and this must never be
-- able to refuse a write the deliverables policies already allowed.
create trigger deliverable_materialise_workflow
  after insert or update of deliverable_type_id on deliverables
  for each row execute function app.tg_deliverable_materialise_workflow();

-- ------------------------------------------------------------------- the manual path ----
-- d.6: an owner may re-run a template onto a deliverable — after the template gained a step, or to
-- apply a different one. SECURITY INVOKER on purpose: this is a person choosing to create work, so
-- the ordinary `sub_tasks` write policies decide, exactly as they would for a hand-added task.
create or replace function public.apply_workflow_template(p_deliverable uuid, p_template uuid default null)
returns integer
language plpgsql security invoker
set search_path = public, app, extensions as $$
begin
  if not app.has_permission('project_tasks', 'manage') then
    raise exception 'laying out a deliverable''s work requires project_tasks:manage' using errcode = '42501';
  end if;
  return app.materialise_deliverable_workflow(p_deliverable, p_template);
end $$;

comment on function public.apply_workflow_template(uuid, uuid) is
  'ADR-0052 d.6: re-run a workflow template onto a deliverable by hand — adds the steps it does not '
  'already have and never duplicates. The automatic path is the trigger; this is for the owner who '
  'wants a different template, or the same one after it gained a step.';

revoke execute on function public.apply_workflow_template(uuid, uuid) from public, anon;
grant execute on function public.apply_workflow_template(uuid, uuid) to authenticated;

commit;
