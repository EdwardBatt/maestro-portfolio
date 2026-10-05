-- I68.4 (ADR-0132 d.3, Edward 30 Sep: "we have had incidents where the deliverable is incorrect and needs to be changed…
-- When the deliverable is changed existing tasks should be cancelled and the new task list generated").
--
-- A deliverable's TYPE is changed directly — asked first on screen — by anyone who may edit the piece
-- (`app.may_edit_deliverable`: its owner, the account manager (and the account director by scope), and
-- `project_tasks:manage` within reach of its department — the department's leads and Traffic). Until now a type change
-- over live tasks was refused (`tg_deliverable_edit_guard`) and, on started work, went only through a change request the
-- owner answered (ADR-0110). The change request stays for the CLIENT asking for something different; a correction is
-- made here.
--
-- What the change does is E7's regeneration (20260926132000), unchanged:
--   * the old type's OPEN tasks (a workflow step not in the new type's workflow) are cancelled, their bookings freed,
--     their assignees told, each cancellation audited;
--   * finished tasks and tasks added by hand (no workflow step) are kept;
--   * the new type's steps are added, unassigned (the type write fires `deliverable_materialise_workflow`).
-- The task list's approval follows ADR-0132 d.4: changed by the OWNER, the new list is approved; by anyone else, it waits
-- for the owner (the Needs-you "approve the task list" card, ADR-0100 / 0119). The owner is told who changed it
-- (`deliverable_type_changed`), unless they did it themselves.
--
-- `preview_deliverable_type_change` answers the confirmation dialog: the tasks that would be cancelled (and who has them),
-- the tasks kept, and the tasks the new type adds — read by the same rules the change uses, so what is shown is what
-- happens (pgTAP 202 holds the two together).
--
-- `change_deliverable_type` is SECURITY DEFINER for the same reason as `apply_deliverable_change_request`: it cancels
-- other people's tasks and frees their bookings, which the caller's own policies do not admit. It is reach-checked first
-- (`app.may_edit_deliverable`), takes only a deliverable and a type of the caller's tenant, and pins `search_path`
-- (ADR-0132 is its ADR).
--
-- `notifications_type_check` is reproduced WHOLE from the latest definition (20260928140000), plus
-- `deliverable_type_changed`.

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
    'deliverable_type_changed'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. I59 (25 Sep) added fourteen values in one migration; I62 (28 Sep, ADR-0123) added '
  'client_activation_requested; I68 (30 Sep, ADR-0132) added deliverable_type_changed.';

-- ============================================================================
-- 1) what a type change would do — the confirmation dialog's read
-- ============================================================================
create or replace function public.preview_deliverable_type_change(p_deliverable uuid, p_type uuid)
returns jsonb
language plpgsql stable security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  d          deliverables%rowtype;
  v_old_tpl  uuid;
  v_new_tpl  uuid;
  v_name     text;
  v_qty      integer;
  v_cancel   jsonb;
  v_keep     jsonb;
  v_add      jsonb;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if not app.may_edit_deliverable(p_deliverable) then
    raise exception 'changing this deliverable is outside your reach%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501', hint = 'deliverable_owner';
  end if;
  if not exists (select 1 from deliverable_types t where t.id = p_type and t.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;

  select dt.default_workflow_template_id into v_old_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = p_type;
  v_name := app.task_segment(d.name);
  v_qty  := greatest(coalesce(d.quantity, 1), 1);

  -- Cancelled: E7's rule — an open task on a workflow step outside the new type's workflow.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.sort_order, t.created_at), '[]'::jsonb)
    into v_cancel
    from sub_tasks t
    join workflow_steps ws on ws.id = t.workflow_step_id
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.status in ('todo', 'in_progress', 'review')
     and v_old_tpl is distinct from v_new_tpl
     and ws.template_id is distinct from v_new_tpl;

  -- Kept: everything else that is not already cancelled.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
                                               'assignee', up.display_name) order by t.sort_order, t.created_at), '[]'::jsonb)
    into v_keep
    from sub_tasks t
    left join workflow_steps ws on ws.id = t.workflow_step_id
    left join user_profiles up on up.id = t.assignee_id
   where t.deliverable_id = d.id
     and t.status <> 'cancelled'
     and not (t.status in ('todo', 'in_progress', 'review')
              and t.workflow_step_id is not null
              and v_old_tpl is distinct from v_new_tpl
              and ws.template_id is distinct from v_new_tpl);

  -- Added: the new type's steps the materialiser would write — its title rule, its "already there" rule.
  select coalesce(jsonb_agg(ws.title_en
                            || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end
                            || case when ws.repeats_per_unit and v_qty > 1 then ' ' || u.n::text else '' end
                            order by ws.sort_order, u.n), '[]'::jsonb)
    into v_add
    from workflow_steps ws
    cross join lateral generate_series(1, case when ws.repeats_per_unit then v_qty else 1 end) as u(n)
   where ws.tenant_id = v_tenant
     and ws.template_id = v_new_tpl
     and ws.is_active
     and not exists (
       select 1 from sub_tasks st
        where st.deliverable_id = d.id
          and st.workflow_step_id = ws.id
          and coalesce(st.unit_index, 0) = coalesce(case when ws.repeats_per_unit then u.n else null end, 0));

  return jsonb_build_object(
    'cancelled', v_cancel,
    'kept', v_keep,
    'added', v_add,
    -- ADR-0132 d.4: the owner's change keeps the list approved; anyone else's leaves it for the owner.
    'approved_after', (d.owner_user_id = auth.uid()),
    'owner_id', d.owner_user_id);
end $$;

comment on function public.preview_deliverable_type_change(uuid, uuid) is
  'I68.4 / ADR-0132 d.3: what changing this deliverable''s type would do — {cancelled: [{id, title, status, assignee}], '
  'kept: [...], added: [title], approved_after, owner_id} — read by change_deliverable_type''s own rules. '
  'Refused outside app.may_edit_deliverable.';

revoke execute on function public.preview_deliverable_type_change(uuid, uuid) from public, anon;
grant  execute on function public.preview_deliverable_type_change(uuid, uuid) to authenticated;

-- ============================================================================
-- 2) the change itself
-- ============================================================================
create or replace function public.change_deliverable_type(p_deliverable uuid, p_type uuid)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant    uuid := app.current_tenant_id();
  v_actor     uuid := auth.uid();
  d           deliverables%rowtype;
  v_old_tpl   uuid;
  v_new_tpl   uuid;
  v_task      sub_tasks%rowtype;
  v_reason    text;
  v_cancelled integer := 0;
  v_before    integer;
  v_after     integer;
  v_prior     text;
  v_prior2    text;
  v_approved  boolean;
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
  if not exists (select 1 from deliverable_types t where t.id = p_type and t.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;
  if p_type is not distinct from d.deliverable_type_id then
    raise exception 'the type is already that' using errcode = '22023';
  end if;

  select dt.default_workflow_template_id into v_old_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
  select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = p_type;

  -- The same flag an accepted change request writes under: the edit guard and the started-work guard admit it.
  v_prior := coalesce(current_setting('app.change_request_apply', true), '');
  perform set_config('app.change_request_apply', 'on', true);

  -- E7, as 20260926132000: the old type's open tasks go.
  if v_old_tpl is distinct from v_new_tpl then
    v_reason := 'The deliverable''s type was changed — its task list is the new type''s.';
    for v_task in
      select t.* from sub_tasks t
        join workflow_steps ws on ws.id = t.workflow_step_id
       where t.deliverable_id = d.id
         and t.status in ('todo', 'in_progress', 'review')
         and ws.template_id is distinct from v_new_tpl
       order by t.sort_order, t.created_at
       for update of t
    loop
      update sub_tasks set status = 'cancelled' where id = v_task.id;
      delete from bookings where sub_task_id = v_task.id;
      insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
      values (v_task.tenant_id, v_actor, 'task_cancelled', 'sub_tasks', v_task.id,
              jsonb_build_object('reason', v_reason, 'deliverable_id', d.id, 'was_status', v_task.status,
                                 'from_type', d.deliverable_type_id, 'to_type', p_type, 'direct', true));
      if v_task.assignee_id is not null and v_task.assignee_id is distinct from v_actor then
        insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
        values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                v_actor, jsonb_build_object('reason', v_reason));
      end if;
      v_cancelled := v_cancelled + 1;
    end loop;
  end if;

  select count(*) into v_before from sub_tasks where deliverable_id = d.id;
  -- The type write fires deliverable_materialise_workflow: the new type's steps, unassigned.
  update deliverables set deliverable_type_id = p_type where id = d.id;
  select count(*) into v_after from sub_tasks where deliverable_id = d.id;

  perform set_config('app.change_request_apply', v_prior, true);

  -- ADR-0132 d.4: the owner's change is approved; anyone else's waits for the owner. One workflow for both types: the
  -- list did not change, so neither does its approval.
  v_approved := d.tasks_approved_at is not null;
  if v_old_tpl is distinct from v_new_tpl then
    v_prior2 := coalesce(current_setting('app.task_list_approval', true), '');
    perform set_config('app.task_list_approval', 'on', true);
    if d.owner_user_id = v_actor then
      update deliverables set tasks_approved_at = now(), tasks_approved_by = v_actor where id = d.id;
      v_approved := true;
    else
      update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
      v_approved := false;
    end if;
    perform set_config('app.task_list_approval', v_prior2, true);
  end if;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_type_changed', 'deliverables', d.id,
          jsonb_build_object('from_type', d.deliverable_type_id, 'to_type', p_type,
                             'cancelled', v_cancelled, 'added', v_after - v_before, 'approved', v_approved));

  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_type_changed', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('from_type', d.deliverable_type_id, 'to_type', p_type,
                               'cancelled', v_cancelled, 'added', v_after - v_before));
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'added', v_after - v_before, 'approved', v_approved);
end $$;

comment on function public.change_deliverable_type(uuid, uuid) is
  'I68.4 / ADR-0132 d.3-d.4: change a deliverable''s type directly, for anyone app.may_edit_deliverable admits. E7''s '
  'regeneration (the old type''s open tasks cancelled, bookings freed, assignees told; finished and hand-added tasks '
  'kept; the new type''s steps added unassigned). The owner''s change leaves the list approved; anyone else''s leaves '
  'it for the owner, who is told (deliverable_type_changed). Returns {cancelled, added, approved}. SECURITY DEFINER: '
  'it cancels other people''s tasks and frees their bookings.';

revoke execute on function public.change_deliverable_type(uuid, uuid) from public, anon;
grant  execute on function public.change_deliverable_type(uuid, uuid) to authenticated;

commit;
