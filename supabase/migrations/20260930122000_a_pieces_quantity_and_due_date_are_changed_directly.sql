-- I68.4, continued (ADR-0132 d.2-d.3, 30 Sep): a deliverable's QUANTITY and DUE DATE are corrected directly — asked
-- first on screen — by anyone who may edit the piece (`app.may_edit_deliverable`: its owner, the account manager, and
-- `project_tasks:manage` within reach of its department). On started work both were refused except through a change
-- request (ADR-0110, `tg_deliverable_started_change_guard`), and the due date of a live deliverable also needed the
-- account manager's route with the client's agreement (ADR-0088 d.7a, `tg_deliverable_due_at_fence`). The change request
-- stays for the CLIENT asking for something different; a correction is made here.
--
-- QUANTITY. There is no E7 path to reuse: an accepted change request writes `quantity` and nothing else — the task list
-- is materialised only on a TYPE change (`deliverable_materialise_workflow` fires on `deliverable_type_id`), so a quantity
-- change has never added or removed a unit's tasks. Done here, on the materialiser's own rules (ADR-0071):
--   * up — each step marked `repeats_per_unit` gains the missing units (n = old+1 … new), titled as the materialiser
--     titles them ("Create Artwork — Poster 4"), unassigned; a unit cancelled by an earlier lowering is brought back
--     (to do, unassigned) — one row per unit is all `uq_sub_tasks_workflow_step_unit` allows. Nothing else in the list
--     is re-added, so a task somebody deleted does not come back;
--   * down — the open unit tasks above the new count are cancelled, their bookings freed, their assignees told, each
--     audited (E7's cancellation); finished units are kept.
--   The added units follow ADR-0132 d.4 through `sub_tasks_added_to_an_approved_list`: the owner's change keeps the list
--   approved, anyone else's leaves it for the owner.
-- DUE DATE. The new day, at 18:00 Iraq (ADR-0076 d.3), written under the same flag the account manager's route and E7
-- use; logged as `deadline_changed` with `direct: true` and no attribution to the client (it is our correction).
--
-- The owner is told what changed and by whom (`deliverable_edited`), unless they made the change.
-- `preview_quantity_change` answers the confirmation dialog: the unit tasks a lower count cancels, the titles a higher
-- one adds.
--
-- `edit_piece_directly` is SECURITY DEFINER for the reasons `change_deliverable_type` is (20260930120000): it cancels
-- other people's tasks and frees their bookings. Reach-checked first; `search_path` pinned; ADR-0132 is its ADR.
--
-- `notifications_type_check` reproduced WHOLE from 20260930120000, plus `deliverable_edited`.

begin;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
    'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added',
    'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested',
    'assignment_overdue',
    'task_reopened', 'deliverable_reopened',
    -- I59
    'task_blocked', 'untimed_round', 'extension_forwarded',
    'change_request_sent', 'change_request_answered', 'change_request_resolved',
    'question_asked', 'question_replied', 'nudged', 'too_much', 'too_much_answered',
    'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
    -- I62 (ADR-0123)
    'client_activation_requested',
    -- I68 (ADR-0132)
    'deliverable_type_changed', 'deliverable_edited'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. I59 (25 Sep) added fourteen values in one migration; I62 (28 Sep, ADR-0123) added '
  'client_activation_requested; I68 (30 Sep, ADR-0132) added deliverable_type_changed and deliverable_edited.';

-- ============================================================================
-- 1) what a quantity change would do
-- ============================================================================
create or replace function public.preview_quantity_change(p_deliverable uuid, p_quantity integer)
returns jsonb
language plpgsql stable security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  d        deliverables%rowtype;
  v_tpl    uuid;
  v_name   text;
  v_old    integer;
  v_new    integer;
  v_cancel jsonb;
  v_add    jsonb;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    raise exception 'changing this deliverable is outside your reach%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501', hint = 'deliverable_owner';
  end if;
  if p_quantity is null or p_quantity < 1 then
    raise exception 'a quantity is at least 1' using errcode = '22023';
  end if;
  select dt.default_workflow_template_id into v_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  v_name := app.task_segment(d.name);
  v_old  := greatest(coalesce(d.quantity, 1), 1);
  v_new  := p_quantity;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.unit_index, t.sort_order), '[]'::jsonb)
    into v_cancel
    from sub_tasks t
    join workflow_steps ws on ws.id = t.workflow_step_id and ws.repeats_per_unit
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.unit_index > v_new
     and t.status in ('todo', 'in_progress', 'review');

  select coalesce(jsonb_agg(ws.title_en
                            || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end
                            || ' ' || u.n::text
                            order by ws.sort_order, u.n), '[]'::jsonb)
    into v_add
    from workflow_steps ws
    cross join lateral generate_series(v_old + 1, v_new) as u(n)
   where v_new > v_old
     and ws.tenant_id = v_tenant and ws.template_id = v_tpl and ws.is_active and ws.repeats_per_unit
     -- a cancelled unit counts as added: the change brings it back
     and not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status <> 'cancelled'
                                                  and st.workflow_step_id = ws.id and st.unit_index = u.n);

  return jsonb_build_object('cancelled', v_cancel, 'added', v_add,
                            'approved_after', d.owner_user_id = auth.uid() or d.tasks_approved_at is null);
end $$;

comment on function public.preview_quantity_change(uuid, integer) is
  'I68.4 / ADR-0132 d.3: what changing this deliverable''s quantity would do — {cancelled: [{id, title, status, '
  'assignee}], added: [title], approved_after}. Refused outside app.may_edit_deliverable.';

revoke execute on function public.preview_quantity_change(uuid, integer) from public, anon;
grant  execute on function public.preview_quantity_change(uuid, integer) to authenticated;

-- ============================================================================
-- 2) the change
-- ============================================================================
create or replace function public.edit_piece_directly(
  p_deliverable uuid,
  p_quantity    integer default null,
  p_due_day     date default null
) returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant    uuid := app.current_tenant_id();
  v_actor     uuid := auth.uid();
  d           deliverables%rowtype;
  v_tpl       uuid;
  v_name      text;
  v_old       integer;
  v_task      sub_tasks%rowtype;
  v_reason    text;
  v_cancelled integer := 0;
  v_added     integer := 0;
  v_ins       integer := 0;
  v_due       timestamptz;
  v_changes   jsonb := '{}'::jsonb;
  v_prior     text;
  v_prior2    text;
  v_w         text;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant for update;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    raise exception 'changing this deliverable is outside your reach%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(p_deliverable), ''),
            hint = 'deliverable_owner';
  end if;
  if d.state = 'archived' then
    raise exception 'this deliverable is closed; there is nothing left to change' using errcode = '22023';
  end if;
  if p_quantity is not null and p_quantity < 1 then
    raise exception 'a quantity is at least 1' using errcode = '22023';
  end if;
  v_old := greatest(coalesce(d.quantity, 1), 1);
  v_due := case when p_due_day is null then null else app.close_of_day(p_due_day) end;
  if (p_quantity is null or p_quantity = v_old) and (v_due is null or v_due is not distinct from d.due_at) then
    raise exception 'nothing to change — the quantity and the due date are already that' using errcode = '22023';
  end if;

  v_prior  := coalesce(current_setting('app.change_request_apply', true), '');
  v_prior2 := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  perform set_config('app.change_request_apply', 'on', true);

  -- ---- quantity ----
  if p_quantity is not null and p_quantity <> v_old then
    select dt.default_workflow_template_id into v_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
    v_name := app.task_segment(d.name);

    if p_quantity < v_old then
      v_reason := format('The deliverable''s quantity was changed from %s to %s — this unit is no longer made.', v_old, p_quantity);
      for v_task in
        select t.* from sub_tasks t
          join workflow_steps ws on ws.id = t.workflow_step_id and ws.repeats_per_unit
         where t.deliverable_id = d.id
           and t.unit_index > p_quantity
           and t.status in ('todo', 'in_progress', 'review')
         order by t.unit_index, t.sort_order
         for update of t
      loop
        update sub_tasks set status = 'cancelled' where id = v_task.id;
        delete from bookings where sub_task_id = v_task.id;
        insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
        values (v_task.tenant_id, v_actor, 'task_cancelled', 'sub_tasks', v_task.id,
                jsonb_build_object('reason', v_reason, 'deliverable_id', d.id, 'was_status', v_task.status,
                                   'from_quantity', v_old, 'to_quantity', p_quantity, 'direct', true));
        if v_task.assignee_id is not null and v_task.assignee_id is distinct from v_actor then
          insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
          values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                  v_actor, jsonb_build_object('reason', v_reason));
        end if;
        v_cancelled := v_cancelled + 1;
      end loop;
    end if;

    update deliverables set quantity = p_quantity where id = d.id;

    if p_quantity > v_old and v_tpl is not null then
      -- A unit cancelled by an earlier lowering is brought back, to do and unassigned: `uq_sub_tasks_workflow_step_unit`
      -- holds one row per (deliverable, step, unit) whatever its status, so it cannot be added twice.
      update sub_tasks t
         set status = 'todo', assignee_id = null, starts_at = null
        from workflow_steps ws
       where ws.id = t.workflow_step_id and ws.repeats_per_unit
         and t.deliverable_id = d.id and t.status = 'cancelled'
         and t.unit_index between v_old + 1 and p_quantity;
      get diagnostics v_added = row_count;
      insert into sub_tasks (tenant_id, deliverable_id, title, description, department_id,
                             status, sort_order, workflow_step_id, unit_index, review_mode, created_by)
      select v_tenant, d.id,
             ws.title_en || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end || ' ' || u.n::text,
             ws.description_en, d.department_id, 'todo', ws.sort_order, ws.id, u.n, ws.review_mode, v_actor
        from workflow_steps ws
        cross join lateral generate_series(v_old + 1, p_quantity) as u(n)
       where ws.tenant_id = v_tenant and ws.template_id = v_tpl and ws.is_active and ws.repeats_per_unit
         and not exists (select 1 from sub_tasks st where st.deliverable_id = d.id
                                                      and st.workflow_step_id = ws.id and st.unit_index = u.n)
       order by ws.sort_order, u.n;
      get diagnostics v_ins = row_count;
      v_added := v_added + v_ins;
      -- ADR-0132 d.4. The insert trigger (`sub_tasks_added_to_an_approved_list`) stands aside under the flag raised
      -- above, so the rule is applied here: new units added by anyone but the owner wait for the owner.
      if v_added > 0 and d.tasks_approved_at is not null and d.owner_user_id is not null
         and d.owner_user_id <> v_actor then
        perform set_config('app.task_list_approval', 'on', true);
        update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
        perform set_config('app.task_list_approval', '', true);
      end if;
    end if;
    v_changes := v_changes || jsonb_build_object('quantity', jsonb_build_object('from', v_old, 'to', p_quantity));
  end if;

  -- ---- due date ----
  if v_due is not null and v_due is distinct from d.due_at then
    perform set_config('app.deliverable_due_at_change', 'on', true);
    update deliverables set due_at = v_due where id = d.id;
    perform set_config('app.deliverable_due_at_change', v_prior2, true);
    if d.due_at is not null then
      v_w := coalesce(current_setting('app.sla_event_writer', true), '');
      perform set_config('app.sla_event_writer', 'on', true);
      insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id, payload)
      values (d.tenant_id, d.id, 'deadline_changed', v_actor,
              jsonb_build_object('from', d.due_at, 'to', v_due, 'direct', true));
      perform set_config('app.sla_event_writer', v_w, true);
    end if;
    v_changes := v_changes || jsonb_build_object('due', jsonb_build_object('from', d.due_at, 'to', v_due));
  end if;

  perform set_config('app.change_request_apply', v_prior, true);

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_edited', 'deliverables', d.id,
          v_changes || jsonb_build_object('cancelled', v_cancelled, 'added', v_added, 'direct', true));

  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_edited', d.name, 'deliverable', d.id, v_actor,
            v_changes || jsonb_build_object('cancelled', v_cancelled, 'added', v_added));
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'added', v_added,
                            'quantity', coalesce(p_quantity, v_old),
                            'due_at', coalesce(v_due, d.due_at));
end $$;

comment on function public.edit_piece_directly(uuid, integer, date) is
  'I68.4 / ADR-0132 d.2-d.3: correct a deliverable''s quantity and/or due date directly, for anyone '
  'app.may_edit_deliverable admits, started or not. Quantity up adds the missing unit tasks, unassigned; down cancels '
  'the open unit tasks above it (bookings freed, assignees told), finished kept. Due at 18:00 Iraq, logged '
  'deadline_changed {direct}. The owner is told (deliverable_edited) unless they made it. Returns {cancelled, added, '
  'quantity, due_at}. SECURITY DEFINER: it cancels other people''s tasks and frees their bookings.';

revoke execute on function public.edit_piece_directly(uuid, integer, date) from public, anon;
grant  execute on function public.edit_piece_directly(uuid, integer, date) to authenticated;

commit;
