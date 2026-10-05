-- I70 (ADR-0133 d.3), follow-up of 30 Sep: "offered by the rule that already governs that field — the same write as
-- its own page".
--
-- 1. A deliverable row's `detail` carries the deliverable's department, so its owner picker offers only that
--    department's leads (ADR-0128); a task row carries its department and whether it has a reviewer yet.
-- 2. `hand_over_item` takes the reviewers a task with none must be given (`p_reviewers`), passed to
--    `update_task_assignment` exactly as the Schedule's assignment dialog passes them — the database refuses a task
--    with no reviewer ("a reviewer must be appointed for this task"), so without this such a task could not be handed
--    over at all. Both re-emitted from their live definitions (pg_get_functiondef, 20260930140000 / 141000).

-- ---------------------------------------------------------------- 1. the items ----
CREATE OR REPLACE FUNCTION app.handover_items_of(p_user uuid)
 RETURNS TABLE(kind text, item_id uuid, label text, context text, detail jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- 1. clients they are account manager for
  select 'client', cl.id, cl.name, null::text,
         jsonb_build_object('status', cl.status)
    from clients cl
   where cl.account_manager_id = p_user and not cl.is_internal
  union all
  -- 2. campaigns and jobs they are account manager for, not closed (a brief waiting on them among them)
  select 'campaign', c.id, c.name, cl.name,
         jsonb_build_object('status', c.status, 'kind', c.kind, 'waiting_on_them', c.status = 'pending_approval')
    from campaigns c
    left join clients cl on cl.id = c.client_id
   where c.account_manager_id = p_user and c.status <> 'closed'
  union all
  -- 3. deliverables they own, not finished (a task list waiting on their approval among them)
  select 'deliverable', d.id, d.name, c.name,
         jsonb_build_object('state', d.state, 'campaign_id', c.id, 'department_id', d.department_id,
                            'task_list_waiting', d.tasks_approved_at is null and c.status = 'approved')
    from deliverables d
    left join streams s on s.id = d.stream_id
    left join campaigns c on c.id = s.campaign_id
   where d.owner_user_id = p_user
     and d.state not in ('approved', 'delivered', 'archived')
     and coalesce(c.status, 'approved') <> 'closed'
  union all
  -- 4. workstreams they own, on a campaign still open
  select 'workstream', w.id, w.name, c.name,
         jsonb_build_object('campaign_id', c.id, 'department_id', w.department_id)
    from workstreams w
    join campaigns c on c.id = w.campaign_id
   where w.owner_user_id = p_user and c.status <> 'closed'
  union all
  -- 5. open tasks assigned to them (their future bookings go with each)
  select 'task', t.id, t.title, d.name,
         jsonb_build_object('status', t.status, 'due_at', t.due_at, 'deliverable_id', d.id, 'campaign_id', s.campaign_id,
                            'department_id', coalesce(t.department_id, d.department_id),
                            'needs_reviewer', not exists (select 1 from sub_task_reviewers rv0 where rv0.sub_task_id = t.id),
                            'future_bookings', (select count(*) from bookings b
                                                 where b.sub_task_id = t.id and b.ends_at > now()
                                                   and b.state in ('soft_hold', 'tentative', 'confirmed')))
    from sub_tasks t
    left join deliverables d on d.id = t.deliverable_id
    left join streams s on s.id = d.stream_id
   where t.assignee_id = p_user and t.status not in ('done', 'cancelled')
  union all
  -- 6. reviews they are appointed to on open tasks, not yet given (the item is the appointment)
  select 'review', rv.id, t.title, d.name,
         jsonb_build_object('sub_task_id', t.id, 'status', t.status, 'deliverable_id', d.id, 'campaign_id', s.campaign_id)
    from sub_task_reviewers rv
    join sub_tasks t on t.id = rv.sub_task_id
    left join deliverables d on d.id = t.deliverable_id
    left join streams s on s.id = d.stream_id
   where rv.user_id = p_user
     and rv.approved_at is null and rv.responded_at is null
     and t.status not in ('done', 'cancelled');
$function$;

comment on function app.handover_items_of(uuid) is
  'ADR-0133 d.3: what a person still holds that someone must take on — clients, campaigns and jobs, deliverables, '
  'workstreams, open tasks, reviews. Internal: the public readers authorise the caller. Deliverable and task rows '
  'carry department_id; a task row says needs_reviewer (I70).';
revoke all on function app.handover_items_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. the hand-over ----
drop function if exists public.hand_over_item(text, uuid, uuid);

CREATE OR REPLACE FUNCTION public.hand_over_item(p_kind text, p_item uuid, p_to uuid, p_reviewers jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_holder     uuid;
  v_to         user_profiles;
  v_title      text;
  v_ws         workstreams;
  v_rv         sub_task_reviewers;
  v_assignee   uuid;
  v_list       jsonb;
  v_outcome    text := 'handed_over';
  v_reschedule boolean := false;
  v_rows       integer;
  v_completed  boolean;
  r            record;
begin
  if p_kind not in ('client', 'campaign', 'deliverable', 'workstream', 'task', 'review') then
    raise exception 'unknown kind of item: %', p_kind using errcode = '22023';
  end if;
  v_holder := app.handover_item_holder(p_kind, p_item);
  if v_holder is null then
    raise exception 'this item is not part of a hand-over of yours' using errcode = '42501';
  end if;
  if not exists (select 1 from user_profiles where id = v_holder and leaving_since is not null and is_active) then
    raise exception 'this person is not leaving' using errcode = '22023';
  end if;

  select * into v_to from user_profiles where id = p_to and tenant_id = app.current_tenant_id();
  if not found or not v_to.is_active then
    raise exception 'hand it to someone active in your organisation' using errcode = '22023';
  end if;
  if v_to.leaving_since is not null then
    raise exception '% is leaving and cannot be given new work', v_to.display_name
      using errcode = '22023', hint = 'person_leaving';
  end if;
  if p_to = v_holder then
    raise exception 'hand it to someone else' using errcode = '22023';
  end if;

  -- The SAME write each field's own page makes (ADR-0133 d.3), under the caller's rights and the field's rules.
  if p_kind = 'client' then
    -- The client form offers holders of account_manager:manage (ADR-0036); the same rule here.
    if not app.user_has_permission(p_to, 'account_manager', 'manage') then
      raise exception '% cannot be an account manager (account_manager:manage)', v_to.display_name using errcode = '22023';
    end if;
    update clients set account_manager_id = p_to where id = p_item and account_manager_id = v_holder;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then
      raise exception 'changing this client''s account manager is outside your reach' using errcode = '42501';
    end if;
  elsif p_kind = 'campaign' then
    perform public.set_campaign_account_manager(p_item, p_to);
  elsif p_kind = 'deliverable' then
    perform public.reassign_deliverable(p_item, p_to);
  elsif p_kind = 'workstream' then
    select * into v_ws from workstreams where id = p_item;
    perform public.save_workstream(v_ws.campaign_id, v_ws.name, v_ws.department_id, p_to, v_ws.id, v_ws.code_letters);
  elsif p_kind = 'task' then
    select t.title into v_title from sub_tasks t where t.id = p_item;
    -- The Schedule's reassignment (ADR-0039 d.6 / ADR-0060): same dates, the new person; bookings follow through
    -- `subtask-schedule` when `reschedule_needed` (the caller invokes it, as the Schedule does).
    -- I70 follow-up: a task with no reviewer takes one here, as the Schedule's assignment dialog asks for it
    -- (`p_reviewers`, the same payload `update_task_assignment` takes, ADR-0043). Null keeps the task's reviewers.
    select * into r from public.update_task_assignment(p_item, v_title, p_to, p_reviewers);
    v_outcome := coalesce(r.outcome, 'assigned');
    v_reschedule := coalesce(r.reschedule_needed, false);
    if v_outcome = 'requested' then
      -- ADR-0087: the new person is outside the caller's reach — a request went to their lead; not handed over yet.
      perform app.record_handover(v_holder, p_kind, p_item, p_to, 'requested');
      return jsonb_build_object('kind', p_kind, 'item_id', p_item, 'to', p_to, 'outcome', 'requested',
                                'reschedule_needed', false, 'completed', false);
    end if;
  elsif p_kind = 'review' then
    select * into v_rv from sub_task_reviewers where id = p_item;
    select t.title, t.assignee_id into v_title, v_assignee from sub_tasks t where t.id = v_rv.sub_task_id;
    -- The task's reviewer list with the leaving person swapped for the new one (mandatory flag kept) — the same
    -- write the task's own reviewer editor makes (`update_task_assignment` with `p_reviewers`, ADR-0043).
    select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'is_mandatory', x.is_mandatory) order by x.created_at), '[]'::jsonb)
      into v_list
      from (select case when rv.id = p_item then p_to else rv.user_id end as user_id,
                   bool_or(rv.is_mandatory) as is_mandatory, min(rv.created_at) as created_at
              from sub_task_reviewers rv
             where rv.sub_task_id = v_rv.sub_task_id
             group by 1) x;
    if v_assignee is not null then
      perform public.update_task_assignment(v_rv.sub_task_id, v_title, v_assignee, v_list);
    else
      -- A task nobody has yet: its appointments are written directly, under the table's own policies.
      if not exists (select 1 from sub_task_reviewers x where x.sub_task_id = v_rv.sub_task_id and x.user_id = p_to) then
        insert into sub_task_reviewers (tenant_id, sub_task_id, user_id, is_mandatory, created_by)
        values (v_rv.tenant_id, v_rv.sub_task_id, p_to, v_rv.is_mandatory, auth.uid());
      end if;
      delete from sub_task_reviewers where id = p_item;
      get diagnostics v_rows = row_count;
      if v_rows = 0 then
        raise exception 'changing this task''s reviewers is outside your reach' using errcode = '42501';
      end if;
    end if;
  end if;

  perform app.record_handover(v_holder, p_kind, p_item, p_to, v_outcome);
  v_completed := app.complete_deactivation_if_done(v_holder);

  return jsonb_build_object('kind', p_kind, 'item_id', p_item, 'to', p_to, 'outcome', v_outcome,
                            'reschedule_needed', v_reschedule, 'completed', v_completed);
end $function$;

revoke all on function public.hand_over_item(text, uuid, uuid, jsonb) from public, anon;
grant execute on function public.hand_over_item(text, uuid, uuid, jsonb) to authenticated;

comment on function public.hand_over_item(text, uuid, uuid, jsonb) is
  'ADR-0133 d.3–d.4: one item of a leaving person''s work handed to a named person, through the same write its own page '
  'makes; the last one completes the deactivation. A task with no reviewer takes p_reviewers ([{user_id,is_mandatory}]), '
  'as the Schedule''s assignment dialog passes them. Returns {kind,item_id,to,outcome,reschedule_needed,completed}.';
