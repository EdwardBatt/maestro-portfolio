-- I74.41 (test script step 29, 4 Oct) — every unit of a step stands at that step's place on the task list.
--
-- Raising a quantity listed the units out of order — "Billboard 2, Billboard 3, Billboard 1". The units added by
-- app.resize_deliverable_units took the TEMPLATE step's number (workflow_steps.sort_order, 4), while the first unit
-- held the LIST's number (5): placing the translation task (app.place_translation_task) moves every task after it down
-- one, so a list's numbers are not the template's. The list orders by sort_order, then unit_index — so the new units
-- jumped ahead of unit 1.
--
--   app.unit_step_position(deliverable, step, fallback)   the place a step's units hold on THIS list: the sort_order of
--       its lowest-numbered unit (a live one first; a cancelled one keeps its place too). The template's number only
--       when the step has no unit on the list yet.
--   app.resize_deliverable_units                            a unit brought back or added takes that place.
--       Reproduced WHOLE from 20261004160000; the two lines that set sort_order change, nothing else.
--   Repair: on every list, a per-unit step's units are put at the place of its lowest-numbered unit (a live one
--       first). Only sort_order moves, and only on rows that are out of step.
begin;

create or replace function app.unit_step_position(p_deliverable uuid, p_step uuid, p_fallback integer)
returns integer
language sql stable
set search_path = public, app, extensions as $$
  select coalesce(
    (select st.sort_order from sub_tasks st
      where st.deliverable_id = p_deliverable and st.workflow_step_id = p_step and st.unit_index is not null
        and st.sort_order is not null
      order by (st.status = 'cancelled'), st.unit_index
      limit 1),
    p_fallback)
$$;
comment on function app.unit_step_position(uuid, uuid, integer) is
  'I74.41: the place a per-unit step''s units hold on a deliverable''s task list — its lowest-numbered unit''s '
  'sort_order (a live unit first), else the fallback (the template step''s number).';
revoke execute on function app.unit_step_position(uuid, uuid, integer) from public, anon, authenticated;

create or replace function app.resize_deliverable_units(p_deliverable uuid, p_to integer, p_reason text, p_extra jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  d           deliverables%rowtype;
  v_actor     uuid := auth.uid();
  v_old       integer;
  v_tpl       uuid;
  v_ctx       text;
  v_type      text;
  v_task      sub_tasks%rowtype;
  v_cancelled integer := 0;
  v_added     integer := 0;
  v_ins       integer := 0;
begin
  select * into d from deliverables where id = p_deliverable;
  v_old := greatest(coalesce(d.quantity, 1), 1);
  if p_to is null or p_to = v_old then
    if p_to is not null and d.quantity is distinct from p_to then
      update deliverables set quantity = p_to where id = d.id;
    end if;
    return jsonb_build_object('cancelled', 0, 'added', 0);
  end if;

  if p_to < v_old then
    for v_task in
      select t.* from sub_tasks t
        join workflow_steps ws on ws.id = t.workflow_step_id and ws.repeats_per_unit
       where t.deliverable_id = d.id
         and t.unit_index > p_to
         and t.status in ('todo', 'in_progress', 'blocked', 'review')
       order by t.unit_index, t.sort_order
       for update of t
    loop
      update sub_tasks set status = 'cancelled' where id = v_task.id;
      delete from bookings where sub_task_id = v_task.id;
      insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
      values (v_task.tenant_id, v_actor, 'task_cancelled', 'sub_tasks', v_task.id,
              jsonb_build_object('reason', p_reason, 'deliverable_id', d.id, 'was_status', v_task.status,
                                 'from_quantity', v_old, 'to_quantity', p_to) || coalesce(p_extra, '{}'::jsonb));
      if v_task.assignee_id is not null and v_task.assignee_id is distinct from v_actor then
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
        values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                v_actor, jsonb_build_object('reason', p_reason) || coalesce(p_extra, '{}'::jsonb));
      end if;
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;

  update deliverables set quantity = p_to where id = d.id;

  select dt.default_workflow_template_id into v_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  if p_to > v_old and v_tpl is not null then
    v_ctx  := app.task_title_context(d.stream_id, d.name);
    v_type := app.type_title(d.deliverable_type_id);
    -- A unit cancelled by an earlier lowering is brought back, to do and unassigned: `uq_sub_tasks_workflow_step_unit`
    -- holds one row per (deliverable, step, unit) whatever its status, so it cannot be added twice.
    update sub_tasks t
       set status = 'todo', assignee_id = null, starts_at = null,
           sort_order = app.unit_step_position(d.id, ws.id, ws.sort_order)
      from workflow_steps ws
     where ws.id = t.workflow_step_id and ws.repeats_per_unit
       and t.deliverable_id = d.id and t.status = 'cancelled'
       and t.unit_index between v_old + 1 and p_to;
    get diagnostics v_added = row_count;
    insert into sub_tasks (tenant_id, deliverable_id, title, description, department_id,
                           status, sort_order, workflow_step_id, unit_index, review_mode, created_by)
    select d.tenant_id, d.id,
           app.compose_task_title(ws.title_en, v_ctx, v_type, u.n, p_to),
           ws.description_en, d.department_id, 'todo', app.unit_step_position(d.id, ws.id, ws.sort_order), ws.id, u.n, ws.review_mode, v_actor
      from workflow_steps ws
      cross join lateral generate_series(v_old + 1, p_to) as u(n)
     where ws.tenant_id = d.tenant_id and ws.template_id = v_tpl and ws.is_active and ws.repeats_per_unit
       and not exists (select 1 from sub_tasks st where st.deliverable_id = d.id
                                                    and st.workflow_step_id = ws.id and st.unit_index = u.n)
     order by ws.sort_order, u.n;
    get diagnostics v_ins = row_count;
    v_added := v_added + v_ins;
    -- ADR-0132 d.4. The insert trigger (`sub_tasks_added_to_an_approved_list`) stands aside under
    -- app.change_request_apply, so the rule is applied here: units added by anyone but the owner wait for the owner.
    if v_added > 0 and d.tasks_approved_at is not null and d.owner_user_id is not null
       and d.owner_user_id is distinct from v_actor then
      perform set_config('app.task_list_approval', 'on', true);
      update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
      perform set_config('app.task_list_approval', '', true);
    end if;
  end if;
  return jsonb_build_object('cancelled', v_cancelled, 'added', v_added);
end $$;
comment on function app.resize_deliverable_units(uuid, integer, text, jsonb) is
  'ADR-0071 d.8 / ADR-0132 d.3: a quantity change made real — units above it cancelled (assignees told), missing ones '
  'brought back or added (app.compose_task_title), the owner''s approval rule applied. Used by edit_piece_directly and '
  'app.apply_deliverable_change_request (I74.39: the change request changed the number and no task). I74.41: a unit '
  'brought back or added takes its step''s place on the list (app.unit_step_position), never the template''s number.';
revoke execute on function app.resize_deliverable_units(uuid, integer, text, jsonb) from public, anon, authenticated;

-- Repair: units of one step share the step's place on the list.
with place as (
  select distinct on (st.deliverable_id, st.workflow_step_id)
         st.deliverable_id, st.workflow_step_id, st.sort_order
    from sub_tasks st
    join workflow_steps ws on ws.id = st.workflow_step_id and ws.repeats_per_unit
   where st.unit_index is not null and st.sort_order is not null
   order by st.deliverable_id, st.workflow_step_id, (st.status = 'cancelled'), st.unit_index
)
update sub_tasks t
   set sort_order = p.sort_order
  from place p
 where t.deliverable_id = p.deliverable_id
   and t.workflow_step_id = p.workflow_step_id
   and t.unit_index is not null
   and t.sort_order is distinct from p.sort_order;

commit;
