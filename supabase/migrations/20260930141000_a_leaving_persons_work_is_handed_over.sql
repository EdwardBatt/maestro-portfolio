-- I70.2–I70.5, I70.7 (ADR-0133, accepted 30 Sep): the hand-over itself.
--
--   public.start_deactivation(p_user)                — the Leaving stage begins (update-user calls it as the admin, after
--                                                      banning sign-in). Its recipients are told (`handover_list`); a person
--                                                      who holds nothing is Deactivated at once.
--   public.handover_items(p_user)                    — the list, for its recipients and for anyone who manages users.
--   public.hand_over_item(p_kind, p_item, p_to)      — one item to a named person, through the SAME write the item's own
--                                                      page makes (so its own rules and notices apply); the last one
--                                                      completes the deactivation.
--   public.leaving_people()                          — the Users page's "Leaving — N items to hand over".
--   app.complete_deactivation / _if_done / app.complete_finished_handovers
--                                                    — d.4: the list empty → is_active = false, the calendar row off
--                                                      (ADR-0014 d.3, moved here), the recipients and the starter told.
--   my_pending_approvals                             — gains `handover` (the recipients' Needs-you card).
--
-- SECURITY DEFINER where the write is not the caller's to make under RLS, each named and authorised:
--   * start_deactivation: marks another person's profile and notifies others; requires users:manage in the caller's
--     tenant (the grant update-user already checks).
--   * handover_items / leaving_people: read what a person holds across the tenant; answered only to a recipient of
--     that person's hand-over or a users:manage holder.
--   * complete_deactivation (+ _if_done, complete_finished_handovers): switches the person and their calendar row
--     off and notifies; acts only on a Leaving person whose list is EMPTY, so calling it early does nothing.
--   * record_handover / handover_item_holder: the audit row and the "whose is this" lookup for hand_over_item,
--     answered only to a recipient or users:manage holder.
-- hand_over_item itself is INVOKER: the item's write is the caller's, under their own RLS and the field's guards
-- (ADR-0133 d.3 — "the same write as changing it on its own page").

-- ---------------------------------------------------------------- the right to act on a hand-over ----
create or replace function app.may_hand_over(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select exists (select 1 from user_profiles up
                  where up.id = p_user and up.tenant_id = app.current_tenant_id())
     and (app.is_handover_recipient(p_user) or app.has_permission('users', 'manage'));
$$;
revoke all on function app.may_hand_over(uuid) from public, anon;
grant execute on function app.may_hand_over(uuid) to authenticated;

-- ---------------------------------------------------------------- notices ----
create or replace function app.notify_handover(p_user uuid, p_type text, p_extra jsonb, p_to_starter boolean)
returns integer
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_up user_profiles;
  v_n  integer;
begin
  select * into v_up from user_profiles where id = p_user;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_up.tenant_id, r.user_id, p_type, v_up.display_name, 'user_profile', v_up.id, auth.uid(),
         jsonb_build_object('user_id', v_up.id, 'name', v_up.display_name) || coalesce(p_extra, '{}'::jsonb)
    from (select app.handover_recipients(p_user) as user_id
          union
          select v_up.leaving_started_by where p_to_starter and v_up.leaving_started_by is not null) r
   where r.user_id is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function app.notify_handover(uuid, text, jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- d.4: completion ----
create or replace function app.complete_deactivation(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_up user_profiles;
  v_handed integer;
begin
  select * into v_up from user_profiles where id = p_user for update;
  if not found or v_up.leaving_since is null or not v_up.is_active then
    return false;                       -- not Leaving: nothing to complete
  end if;
  if app.handover_item_total(p_user) > 0 then
    return false;                       -- d.4: never over work still held
  end if;

  perform set_config('app.system_op', 'on', true);
  update user_profiles set is_active = false where id = p_user;
  -- ADR-0014 d.3, moved here by ADR-0133: the calendar row leaves the bookable pool when the deactivation COMPLETES.
  update resources set is_active = false where user_id = p_user and tenant_id = v_up.tenant_id;
  perform set_config('app.system_op', 'off', true);

  select count(*)::int into v_handed
    from audit_events a
   where a.tenant_id = v_up.tenant_id and a.action = 'handover_item'
     and a.payload ->> 'from' = p_user::text and a.created_at >= v_up.leaving_since;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v_up.tenant_id, auth.uid(), 'deactivation_completed', 'user_profiles', p_user,
          jsonb_build_object('leaving_since', v_up.leaving_since, 'handed_over', v_handed));

  perform app.notify_handover(p_user, 'deactivation_complete', jsonb_build_object('handed_over', v_handed), true);
  return true;
end $$;
revoke all on function app.complete_deactivation(uuid) from public, anon, authenticated;

-- Callable by anyone signed in, and harmless: it completes only a Leaving person with nothing left, which is the
-- state d.4 says completes itself. hand_over_item (invoker) calls it after each hand-over.
create or replace function app.complete_deactivation_if_done(p_user uuid)
returns boolean
language sql
security definer
set search_path = public, app, extensions
as $$
  select case when exists (select 1 from user_profiles up
                            where up.id = p_user and up.tenant_id = app.current_tenant_id()
                              and up.leaving_since is not null and up.is_active)
              then app.complete_deactivation(p_user) else false end;
$$;
revoke all on function app.complete_deactivation_if_done(uuid) from public, anon;
grant execute on function app.complete_deactivation_if_done(uuid) to authenticated;

-- The sweep's catch-up: an item handed on from its own page (not the hand-over page) can empty a list too.
create or replace function app.complete_finished_handovers()
returns integer
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in select up.id from user_profiles up where up.leaving_since is not null and up.is_active loop
    if app.complete_deactivation(v_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke all on function app.complete_finished_handovers() from public, anon, authenticated;

-- ---------------------------------------------------------------- d.1: the Leaving stage begins ----
create or replace function public.start_deactivation(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_up     user_profiles;
  v_total  integer;
  v_counts jsonb;
  v_told   integer := 0;
  v_done   boolean := false;
begin
  if auth.uid() is null or not app.has_permission('users', 'manage') then
    raise exception 'only someone who manages users can deactivate a person' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'you cannot deactivate your own account' using errcode = '22023', hint = 'cannot_lockout_self';
  end if;
  select * into v_up from user_profiles
   where id = p_user and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'no such person in your organisation' using errcode = 'P0002';
  end if;
  if not v_up.is_active then
    raise exception '% is already deactivated', v_up.display_name using errcode = '22023', hint = 'already_deactivated';
  end if;
  if v_up.leaving_since is not null then
    -- A second press while Leaving: the hand-over is already under way.
    return jsonb_build_object('leaving', true, 'already', true,
                              'items', app.handover_item_counts(p_user), 'total', app.handover_item_total(p_user));
  end if;

  perform set_config('app.system_op', 'on', true);
  update user_profiles set leaving_since = now(), leaving_started_by = auth.uid() where id = p_user;
  perform set_config('app.system_op', 'off', true);

  v_total  := app.handover_item_total(p_user);
  v_counts := app.handover_item_counts(p_user);

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v_up.tenant_id, auth.uid(), 'deactivation_started', 'user_profiles', p_user,
          jsonb_build_object('items', v_counts, 'total', v_total));

  if v_total = 0 then
    v_done := app.complete_deactivation(p_user);
  else
    v_told := app.notify_handover(p_user, 'handover_list', jsonb_build_object('items', v_counts, 'total', v_total), false);
  end if;

  return jsonb_build_object('leaving', not v_done, 'completed', v_done, 'items', v_counts, 'total', v_total,
                            'recipients_told', v_told);
end $$;
revoke all on function public.start_deactivation(uuid) from public, anon;
grant execute on function public.start_deactivation(uuid) to authenticated;

comment on function public.start_deactivation(uuid) is
  'ADR-0133 d.1–d.2: the Leaving stage — the person is marked leaving and their hand-over list goes to their department '
  'lead (or the Traffic Manager and the Power Admins). Holding nothing, they are Deactivated at once. users:manage.';

-- ---------------------------------------------------------------- d.3: the list ----
create or replace function public.handover_items(p_user uuid)
returns table (kind text, item_id uuid, label text, context text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public, app, extensions
as $$
begin
  if not app.may_hand_over(p_user) then
    raise exception 'this person''s hand-over is not yours' using errcode = '42501';
  end if;
  return query select * from app.handover_items_of(p_user) i order by i.kind, i.context nulls first, i.label;
end $$;
revoke all on function public.handover_items(uuid) from public, anon;
grant execute on function public.handover_items(uuid) to authenticated;

-- The Users page and the hand-over page's header: who is leaving, since when, how much is left.
create or replace function public.leaving_people()
returns table (user_id uuid, name text, department text, leaving_since timestamptz, started_by_name text,
               items_remaining integer, items jsonb)
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select up.id, up.display_name, dp.name, up.leaving_since, st.display_name,
         app.handover_item_total(up.id), app.handover_item_counts(up.id)
    from user_profiles up
    left join departments dp on dp.id = up.department_id
    left join user_profiles st on st.id = up.leaving_started_by
   where up.tenant_id = app.current_tenant_id()
     and up.leaving_since is not null and up.is_active
     and app.may_hand_over(up.id)
   order by up.leaving_since;
$$;
revoke all on function public.leaving_people() from public, anon;
grant execute on function public.leaving_people() to authenticated;

-- ---------------------------------------------------------------- one item handed on ----
create or replace function app.handover_item_holder(p_kind text, p_item uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, app, extensions
as $$
declare
  v uuid;
begin
  v := case p_kind
         when 'client'      then (select account_manager_id from clients where id = p_item)
         when 'campaign'    then (select account_manager_id from campaigns where id = p_item)
         when 'deliverable' then (select owner_user_id from deliverables where id = p_item)
         when 'workstream'  then (select owner_user_id from workstreams where id = p_item)
         when 'task'        then (select assignee_id from sub_tasks where id = p_item)
         when 'review'      then (select user_id from sub_task_reviewers where id = p_item)
       end;
  -- Answered only to someone entitled to this person's hand-over; to anyone else it is nobody's.
  if v is null or not app.may_hand_over(v) then
    return null;
  end if;
  return v;
end $$;
revoke all on function app.handover_item_holder(text, uuid) from public, anon;
grant execute on function app.handover_item_holder(text, uuid) to authenticated;

create or replace function app.record_handover(p_holder uuid, p_kind text, p_item uuid, p_to uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
begin
  if not app.may_hand_over(p_holder) then
    raise exception 'this person''s hand-over is not yours' using errcode = '42501';
  end if;
  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  select up.tenant_id, auth.uid(), 'handover_item', 'user_profiles', p_holder,
         jsonb_build_object('from', p_holder, 'to', p_to, 'kind', p_kind, 'item_id', p_item, 'outcome', p_outcome)
    from user_profiles up where up.id = p_holder;
end $$;
revoke all on function app.record_handover(uuid, text, uuid, uuid, text) from public, anon;
grant execute on function app.record_handover(uuid, text, uuid, uuid, text) to authenticated;

create or replace function public.hand_over_item(p_kind text, p_item uuid, p_to uuid)
returns jsonb
language plpgsql
set search_path = public, app, extensions
as $$
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
    select * into r from public.update_task_assignment(p_item, v_title, p_to);
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
end $$;
revoke all on function public.hand_over_item(text, uuid, uuid) from public, anon;
grant execute on function public.hand_over_item(text, uuid, uuid) to authenticated;

comment on function public.hand_over_item(text, uuid, uuid) is
  'ADR-0133 d.3–d.4: one item of a leaving person''s work handed to a named person, through the same write its own page '
  'makes; the last one completes the deactivation. Returns {kind,item_id,to,outcome,reschedule_needed,completed}.';

-- ---------------------------------------------------------------- Needs you: the recipients' card ----
-- Re-emitted from 20260929160000 (the live definition, via pg_get_functiondef) with the `handover` arm last.
CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS TABLE(kind text, id uuid, title text, campaign_id uuid, campaign_name text, department text, since timestamp with time zone, target_id uuid, deliverable_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ADR-0100 d.4: "write your department's brief" and "approve your department's brief" are GONE.
  -- The document they asked for no longer exists, so neither does the ask. (Removing them also
  -- takes out the branch I54.25 found scanning every task in the tenant — a side effect, not a
  -- reason.)
  -- A task list waiting for approval (ADR-0090; every campaign since ADR-0100 d.2) — on the owner's list,
  -- and (ADR-0119 d.2) on the department lead's and every team lead's of the deliverable's department,
  -- where they may approve it. Every campaign, however old (d.1). `since` is when its clock started —
  -- the one the escalation reads (d.3), so the card and the sweep agree.
  -- I66.3 (Edward, 29 Sep): a piece with no live task has no list to approve — "there is nothing to count" —
  -- but its owner still owes something: the tasks. Same people, same clock, its own kind, so the card says
  -- "define the tasks" and the "Task lists not approved" figures leave it out.
  select case when not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
              then 'task_list_undefined' else 'task_list' end,
         d.id, d.name, c.id, c.name, dp.name, app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
    left join user_profiles own on own.id = d.owner_user_id
   where c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and (d.owner_user_id = auth.uid()
          or app.leads_department(coalesce(d.department_id, own.department_id)))
     and app.may_approve_deliverable_tasks(d)
     -- I66.11: a piece whose every task was cancelled has its own card, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- I66.11 (Edward, 29 Sep, option B): every task on the piece was cancelled and none was done, so nothing will
  -- close it (ADR-0118 addendum: work all called off is never Approved). Its OWNER is asked to add a task or
  -- close the deliverable; `since` is the last cancellation.
  select 'tasks_all_cancelled', d.id, d.name, c.id, c.name, dp.name,
         (select max(t.updated_at) from sub_tasks t where t.deliverable_id = d.id), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and d.owner_user_id = auth.uid()
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')

  union all
  -- A booking on somebody I lead, asked for by somebody outside their reach (ADR-0087).
  select 'booking_request', q.id, q.title, c.id, c.name, dp.name, q.created_at, q.sub_task_id, d.id
    from sub_task_assignment_requests q
    join sub_tasks st   on st.id = q.sub_task_id
    join deliverables d on d.id = st.deliverable_id
    left join streams s      on s.id = d.stream_id
    left join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where q.status = 'pending'
     and q.requested_by <> auth.uid()
     and auth.uid() in (select a.user_id from public.assignment_request_approvers(q.resource_id) a)
     and app.has_permission('bookings', 'create')
     and app.resource_in_scheduling_scope(q.resource_id)

  union all
  -- A deadline extension asked of ME (ADR-0088).
  select 'extension_request', x.request_id, x.task_title, x.campaign_id, x.campaign_name, dp.name, x.created_at, x.sub_task_id, x.deliverable_id
    from public.sub_task_extension_requests x
    left join departments dp on dp.id = x.department_id
   where x.event_type = 'extension_requested'
     and x.is_pending
     and x.approver_id = auth.uid()
     and x.viewer_can_decide
     and x.actor_id <> auth.uid()

  union all
  -- A campaign or job waiting for ME, its account manager (ADR-0048 d.9).
  select 'campaign', c.id, c.name, c.id, null, null, c.created_at, c.id, null::uuid
    from campaigns c
   where c.status = 'pending_approval'
     and c.account_manager_id = auth.uid()
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, c.account_manager_id)

  union all
  -- ADR-0133 d.2 (I70.3): a leaving person's work, for ME to hand over — their department lead, or (none, or they
  -- ARE the lead) the Traffic Manager and the Power Admins. `id` and `target_id` are the person; `title` their name;
  -- `since` the day they started leaving (the escalation's clock, d.5).
  select 'handover', up.id, up.display_name, null::uuid, null::text, dp.name, up.leaving_since, up.id, null::uuid
    from user_profiles up
    left join departments dp on dp.id = up.department_id
   where up.tenant_id = app.current_tenant_id()
     and up.leaving_since is not null and up.is_active
     and app.is_handover_recipient(up.id)

  order by 7 asc nulls last;
$function$;
