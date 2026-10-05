-- I59.31 / E5, E6, E7 (Edward, 25 Sep) — ADR-0110's change request, as answered, and ADR-0088 d.7a
-- relaxed.
--
--   E5  A due-date change ASKS for the client's evidence but never blocks — on a change request AND on
--       the existing route (`deliverable_due_at_change`, ADR-0088 d.7a "no attachment, no change" is
--       relaxed). Every change is logged with whether evidence came with it: `deadline_changed`
--       carries `evidence_attached` (boolean) and `evidence_asset_id` (when given). An asset that IS
--       given must still be filed in the campaign's own folders (the check d.7a had) — a wrong file
--       is refused, a missing one is not. The change request records the same on its row
--       (`evidence_asset_id`, `evidence_attached`), and the promise it moves is logged with it.
--   E6  Change requests carry TYPE, QUANTITY and DUE only — 'department' is refused in p_changes. The
--       owner is changed by the existing Change owner (reassign_deliverable → owner_user_id), saved
--       straight away; the department follows it (ADR-0102's stamp). The started-work guard already
--       lets that through (an UPDATE naming only owner_user_id never fires it — its column list is
--       type, quantity, department, due — and a department moving WITH its owner is passed); it is
--       reproduced below only so its refusal no longer points a lone department edit at a change
--       request that can no longer carry one. (A department written alone on an OWNED deliverable
--       never reaches that refusal: tg_deliverable_stamp_department puts the owner's back first. It
--       is said only when the owner has no department.)
--   E7  Accepting a TYPE change on started work: the old type's OPEN tasks (todo / in_progress /
--       blocked / review) are CANCELLED with a reason naming the request (an audit_events row
--       'task_cancelled' and the `cancelled` notice to the assignee, detail.reason), their bookings
--       released; finished (done) and already-cancelled tasks are kept. The new type's task list is
--       added UNASSIGNED by the ADR-0052 generator (`app.materialise_deliverable_workflow`, fired by
--       the type write itself — `deliverable_materialise_workflow`), and the task list is NOT
--       approved: `tasks_approved_at` / `_by` are cleared, so the owner approves it again (ADR-0100)
--       and nobody is assigned until they do (ADR-0090's gate). Amends ADR-0052 d.6 for THIS route
--       only: `tg_deliverable_edit_guard` still refuses a type change over live tasks everywhere else.
--       "The old type's tasks" = the tasks the old type's workflow made (workflow_step_id set, on a
--       step that is not in the new type's workflow). A task added by hand (no workflow step) is kept
--       — the smallest change; a question for Edward. When both types share one workflow template
--       nothing is cancelled, nothing new is made and the list's approval stands (the list already is
--       that workflow).
--
-- Reproduced WHOLE from their latest definitions (grep confirmed 26 Sep):
--   app.tg_deliverable_edit_guard            (20260917150000) — the live-task refusal skipped for
--                                             the change-request apply (flag app.change_request_apply);
--   app.tg_deliverable_started_change_guard  (20260926111000) — the refusal's words (E6);
--   app.apply_deliverable_change_request     (20260926111000) — E5 log, E7 regenerate, department gone;
--   public.request_deliverable_change        (20260926111000) — E6, and p_evidence_asset (E5). The
--     signature gains `p_evidence_asset uuid default null`, so the 4-argument function is DROPPED and
--     the 5-argument one created; every caller (pgTAP 166 / 168; no frontend caller yet) passes
--     positional or named arguments that resolve to it unchanged;
--   public.deliverable_due_at_change         (20260914130000) — E5.
--
-- SECURITY DEFINER, as before (AGENTS.md §6). search_path pinned on every function.
--
-- Tests: supabase/tests/176_the_owner_forwards_with_a_note_and_hears_every_answer.sql (E5–E7 part)

begin;

-- ============================================================================
-- 1) the request records its evidence (E5)
-- ============================================================================
alter table deliverable_change_requests
  add column if not exists evidence_asset_id uuid references assets(id),
  add column if not exists evidence_attached boolean generated always as (evidence_asset_id is not null) stored;

comment on column deliverable_change_requests.evidence_asset_id is
  'I59 E5: the client''s evidence for the change, when it came with the request — an asset filed in '
  'the campaign''s folders. Asked for, never required.';
comment on column deliverable_change_requests.evidence_attached is
  'I59 E5: whether evidence came with the request ("logged so we can see the record").';

comment on table deliverable_change_requests is
  'ADR-0110: a change to a STARTED deliverable''s type, quantity or due date (I59 E6: no longer '
  'department), asked of its owner. Every transition is an RPC (request / answer / resolve / close); '
  'there is no client write policy. Read tenant-wide, like the other per-piece records.';

-- ============================================================================
-- 2) the edit guard — the type-change refusal is skipped for the change-request apply (E7)
-- ============================================================================
create or replace function app.tg_deliverable_edit_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name
     and new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if length(trim(new.name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if new.deliverable_type_id is distinct from old.deliverable_type_id
     and old.deliverable_type_id is not null
     -- I59 E7: an accepted change request regenerates the list itself (the old type's open tasks
     -- cancelled, the new type's added for the owner to approve), so it is not refused here.
     and coalesce(current_setting('app.change_request_apply', true), '') <> 'on'
     and exists (select 1 from sub_tasks t where t.deliverable_id = old.id and t.status not in ('done', 'cancelled')) then
    raise exception
      'this deliverable already has tasks from its type — cancel them first, or leave the type as it is'
      using errcode = '22023';
  end if;
  if old.owner_user_id = auth.uid()
     or app.deliverable_account_manager(old.id) = auth.uid()
     or (app.has_permission('project_tasks', 'manage')
         and app.in_write_scope(old.department_id, null, app.deliverable_account_manager(old.id))) then
    return new;
  end if;
  raise exception
    'editing this deliverable is outside your reach — its owner, its department''s leads or the account manager can'
    using errcode = '42501';
end $$;

comment on function app.tg_deliverable_edit_guard() is
  'I52.13 / I52.21: who may change a deliverable''s name, type or quantity — its owner, the '
  'campaign''s account manager, or project_tasks:manage within reach of its department. A blank name '
  'is refused; a type CHANGE on a deliverable with live tasks is refused (a second list would land on '
  'the first, ADR-0052 d.6) — except when an accepted change request writes it (I59 E7), which '
  'regenerates the list itself. Held in Postgres so a PATCH and the RPCs are governed identically.';

-- ============================================================================
-- 3) the started-work guard — its words (E6)
-- ============================================================================
create or replace function app.tg_deliverable_started_change_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if auth.uid() is null or app.is_system_op()
     or coalesce(current_setting('app.change_request_apply', true), '') = 'on' then
    return new;
  end if;
  if new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity
     and new.due_at is not distinct from old.due_at
     -- a department that moves WITH its owner is an owner change (ADR-0102), not a department edit
     and (new.department_id is not distinct from old.department_id
          or new.owner_user_id is distinct from old.owner_user_id) then
    return new;
  end if;
  if not app.deliverable_is_started(old.id) then
    return new;
  end if;
  if new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity
     and new.due_at is not distinct from old.due_at then
    -- E6: only the department moved, alone. It is the owner's (ADR-0102) — never a change request.
    raise exception
      'A deliverable''s department is its owner''s — change its owner to move it.'
      using errcode = '55000', hint = 'department_follows_owner';
  end if;
  raise exception
    'Work on this deliverable has started, so its type, quantity or due date changes only by a change request to its owner.%',
    app.refusal_ask(app.refusal_names_deliverable_owner(old.id))
    using errcode = '55000',
          detail = coalesce(app.refusal_names_deliverable_owner(old.id), ''),
          hint = 'change_request_required';
end $$;

comment on function app.tg_deliverable_started_change_guard() is
  'ADR-0110 d.1 / I59 E6: on a STARTED deliverable, type, quantity and due date change only when '
  'app.apply_deliverable_change_request writes them (flag app.change_request_apply); a lone department '
  'change is refused (it follows the owner). Name, priority, notes and every other column are '
  'untouched; an owner change carrying its department passes.';

-- ============================================================================
-- 4) applying (E5 log, E7 regenerate)
-- ============================================================================
create or replace function app.apply_deliverable_change_request(p_request uuid, p_due_override date)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  r         deliverable_change_requests%rowtype;
  d         deliverables%rowtype;
  v_type    uuid;
  v_qty     integer;
  v_due     timestamptz;
  v_has_due boolean;
  v_prior   text;
  v_prior2  text;
  v_prior3  text;
  v_w       text;
  v_old_tpl uuid;
  v_new_tpl uuid;
  v_task    sub_tasks%rowtype;
  v_reason  text;
begin
  select * into r from deliverable_change_requests where id = p_request for update;
  select * into d from deliverables where id = r.deliverable_id for update;

  v_type := case when r.changes ? 'type' then (r.changes -> 'type' ->> 'to')::uuid else d.deliverable_type_id end;
  v_qty  := case when r.changes ? 'quantity' then (r.changes -> 'quantity' ->> 'to')::integer else d.quantity end;
  v_has_due := r.changes ? 'due' or p_due_override is not null;
  v_due  := case when p_due_override is not null then app.close_of_day(p_due_override)
                 when r.changes ? 'due' then app.close_of_day((r.changes -> 'due' ->> 'to')::date)
                 else d.due_at end;

  v_prior := coalesce(current_setting('app.change_request_apply', true), '');
  perform set_config('app.change_request_apply', 'on', true);
  -- E5: the promise moves on the owner's answer; the evidence that came with the request (or not)
  -- is logged below.
  v_prior2 := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  if v_has_due then perform set_config('app.deliverable_due_at_change', 'on', true); end if;

  -- ---- E7: a type change regenerates the task list ----
  if r.changes ? 'type' and v_type is distinct from d.deliverable_type_id then
    select dt.default_workflow_template_id into v_old_tpl from deliverable_types dt where dt.id = d.deliverable_type_id;
    select dt.default_workflow_template_id into v_new_tpl from deliverable_types dt where dt.id = v_type;

    if v_old_tpl is distinct from v_new_tpl then
      v_reason := format('The deliverable''s type changed (change request %s) — its task list is the new type''s.', r.id);
      for v_task in
        select t.* from sub_tasks t
          join workflow_steps ws on ws.id = t.workflow_step_id
         where t.deliverable_id = d.id
           and t.status in ('todo', 'in_progress', 'blocked', 'review')
           and ws.template_id is distinct from v_new_tpl
         order by t.sort_order, t.created_at
         for update of t
      loop
        update sub_tasks set status = 'cancelled' where id = v_task.id;
        -- Cancelled work stops consuming capacity (sub_task_cancel's rule).
        delete from bookings where sub_task_id = v_task.id;
        insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
        values (v_task.tenant_id, auth.uid(), 'task_cancelled', 'sub_tasks', v_task.id,
                jsonb_build_object('reason', v_reason, 'change_request_id', r.id,
                                   'deliverable_id', d.id, 'was_status', v_task.status,
                                   'from_type', d.deliverable_type_id, 'to_type', v_type));
        if v_task.assignee_id is not null and v_task.assignee_id is distinct from auth.uid() then
          insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
          values (v_task.tenant_id, v_task.assignee_id, 'cancelled', v_task.title, 'sub_task', v_task.id,
                  auth.uid(), jsonb_build_object('reason', v_reason, 'change_request_id', r.id));
        end if;
      end loop;
    end if;

    -- The type write fires deliverable_materialise_workflow: the new type's steps are added,
    -- unassigned, idempotent on (deliverable, step, unit).
    update deliverables set deliverable_type_id = v_type where id = d.id;

    -- ADR-0100: the owner approves the new task list before anyone is assigned. (One workflow for both
    -- types: the list did not change, so neither does its approval.)
    if v_old_tpl is distinct from v_new_tpl then
      v_prior3 := coalesce(current_setting('app.task_list_approval', true), '');
      perform set_config('app.task_list_approval', 'on', true);
      update deliverables set tasks_approved_at = null, tasks_approved_by = null where id = d.id;
      perform set_config('app.task_list_approval', v_prior3, true);
    end if;
  end if;

  -- One write per field that the request names, so nothing it does not name is touched.
  if r.changes ? 'quantity' then
    update deliverables set quantity = v_qty where id = d.id;
  end if;
  if v_has_due then
    update deliverables set due_at = v_due where id = d.id;
  end if;

  perform set_config('app.deliverable_due_at_change', v_prior2, true);
  perform set_config('app.change_request_apply', v_prior, true);

  if v_has_due and v_due is distinct from d.due_at then
    v_w := coalesce(current_setting('app.sla_event_writer', true), '');
    perform set_config('app.sla_event_writer', 'on', true);
    insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
    values (d.tenant_id, d.id, 'deadline_changed',
            case when r.asked_by = 'client' then 'client'::attribution_party end, auth.uid(),
            jsonb_build_object('from', d.due_at, 'to', v_due, 'change_request_id', r.id,
                               'asked_by', r.asked_by,
                               'evidence_attached', r.evidence_asset_id is not null,
                               'evidence_asset_id', r.evidence_asset_id));
    perform set_config('app.sla_event_writer', v_w, true);
  end if;

  if r.asked_by = 'client' then
    update deliverable_change_requests set round_spent = true where id = r.id;
  end if;
end $$;

revoke execute on function app.apply_deliverable_change_request(uuid, date) from public, anon, authenticated;

-- ============================================================================
-- 5) asking — type, quantity, due; evidence asked for (E5, E6)
-- ============================================================================
drop function if exists public.request_deliverable_change(uuid, jsonb, text, jsonb);

create or replace function public.request_deliverable_change(
  p_deliverable    uuid,
  p_changes        jsonb,
  p_asked_by       text,
  p_cost           jsonb default null,
  p_evidence_asset uuid default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant  uuid := app.current_tenant_id();
  v_actor   uuid := auth.uid();
  d         deliverables%rowtype;
  v_key     text;
  v_to      text;
  v_changes jsonb := '{}'::jsonb;
  v_from    text;
  v_campaign uuid;
  v_id      uuid;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant for update;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;

  if not app.may_edit_deliverable(p_deliverable) then
    raise exception 'You cannot ask for a change to this deliverable: it is outside your reach.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(p_deliverable))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(p_deliverable), ''),
            hint = 'request_deliverable_change';
  end if;
  if d.state = 'archived' then
    raise exception 'this deliverable is closed; there is nothing left to change' using errcode = '22023';
  end if;
  if not app.deliverable_is_started(p_deliverable) then
    raise exception 'work on this deliverable has not started — edit it directly' using errcode = '22023';
  end if;
  if d.owner_user_id is null then
    raise exception 'this deliverable has no owner to answer a change request — give it an owner first'
      using errcode = '22023';
  end if;
  if p_asked_by is null or p_asked_by not in ('client', 'us') then
    raise exception 'say who asked for the change: the client, or us' using errcode = '22023';
  end if;
  if p_cost is not null and jsonb_typeof(p_cost) <> 'object' then
    raise exception 'the cost is a set of named figures' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'say what should change: its type, quantity or due date' using errcode = '22023';
  end if;
  if exists (select 1 from deliverable_change_requests r
              where r.deliverable_id = p_deliverable and r.status in ('pending', 'pushed_back')) then
    raise exception 'a change request on this deliverable is already open — it is answered first'
      using errcode = '55000';
  end if;

  -- E5: evidence is asked for, never required; a file that IS given is the campaign's own.
  if p_evidence_asset is not null then
    select s.campaign_id into v_campaign from streams s where s.id = d.stream_id;
    if v_campaign is null or not exists (
         select 1 from assets a join asset_folders f on f.id = a.folder_id
          where a.id = p_evidence_asset and a.tenant_id = v_tenant and f.campaign_id = v_campaign) then
      raise exception 'that evidence is not filed in this campaign''s folders — file it there, or send the request without it'
        using errcode = '22023', hint = 'evidence_not_in_campaign';
    end if;
  end if;

  -- Each field: known, a real value, and different from today. `from` is read here, never taken.
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key = 'department' then
      -- E6: the department is its owner's (ADR-0102). Changing the owner needs no approval.
      raise exception 'A deliverable''s department follows its owner — use Change owner instead; it saves straight away.'
        using errcode = '22023', hint = 'change_request_no_department';
    end if;
    if v_key not in ('type', 'quantity', 'due') then
      raise exception 'only the type, quantity and due date go through a change request — % saves as it is', v_key
        using errcode = '22023';
    end if;
    v_to := case when jsonb_typeof(p_changes -> v_key) = 'object'
                 then p_changes -> v_key ->> 'to' else p_changes ->> v_key end;
    if v_to is null or trim(v_to) = '' then
      raise exception 'say what the % should become', v_key using errcode = '22023';
    end if;
    begin
      if v_key = 'type' then
        if not exists (select 1 from deliverable_types t where t.id = v_to::uuid and t.tenant_id = v_tenant) then
          raise exception 'that deliverable type is not in your organization' using errcode = '22023';
        end if;
        v_from := d.deliverable_type_id::text;
      elsif v_key = 'quantity' then
        if v_to::integer < 1 then
          raise exception 'a quantity is at least 1' using errcode = '22023';
        end if;
        v_to := (v_to::integer)::text;
        v_from := d.quantity::text;
      else -- due: a day, landing at 18:00 Iraq (ADR-0076 d.3), as every deadline does
        v_to := (v_to::date)::text;
        if app.close_of_day(v_to::date) is not distinct from d.due_at then
          raise exception 'the due date is already that' using errcode = '22023';
        end if;
        v_from := d.due_at::text;
      end if;
    exception
      when invalid_text_representation or datetime_field_overflow or invalid_datetime_format
           or numeric_value_out_of_range then
        raise exception 'the new % is not a valid value', v_key using errcode = '22023';
    end;
    if v_key <> 'due' and v_from is not distinct from v_to then
      raise exception 'the % is already that', v_key using errcode = '22023';
    end if;
    v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('from', v_from, 'to', v_to));
  end loop;

  insert into deliverable_change_requests
    (tenant_id, deliverable_id, requested_by, owner_user_id, changes, asked_by, cost, evidence_asset_id)
  values (v_tenant, p_deliverable, v_actor, d.owner_user_id, v_changes, p_asked_by,
          coalesce(p_cost, '{}'::jsonb), p_evidence_asset)
  returning id into v_id;

  if d.owner_user_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, d.owner_user_id, 'change_request_sent', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('change_request_id', v_id, 'changes', v_changes, 'asked_by', p_asked_by,
                               'cost', coalesce(p_cost, '{}'::jsonb),
                               'evidence_attached', p_evidence_asset is not null));
  end if;
  return v_id;
end $$;

comment on function public.request_deliverable_change(uuid, jsonb, text, jsonb, uuid) is
  'ADR-0110 d.1 / I59 E5, E6: ask the owner of a STARTED deliverable to change its type, quantity or '
  'due date (never its department — that follows the owner). p_changes is {field: {to}} (or {field: '
  'value}); the server records from. p_asked_by is client | us. p_evidence_asset: the client''s '
  'evidence, optional, filed in the campaign''s folders; recorded as evidence_attached. Tells the owner.';

revoke execute on function public.request_deliverable_change(uuid, jsonb, text, jsonb, uuid) from public, anon;
grant  execute on function public.request_deliverable_change(uuid, jsonb, text, jsonb, uuid) to authenticated;

-- ============================================================================
-- 6) ADR-0088 d.7a relaxed — evidence asked for, never required (E5)
-- ============================================================================
create or replace function public.deliverable_due_at_change(
  p_deliverable    uuid,
  p_due_day        date,
  p_evidence_asset uuid,
  p_note           text default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := auth.uid();
  d          deliverables%rowtype;
  v_campaign uuid;
  v_to       timestamptz;
  v_prior    text;
  v_id       uuid;
  v_w        text;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;

  select s.campaign_id into v_campaign
    from streams s
   where s.id = d.stream_id;
  if v_campaign is null then
    raise exception 'this deliverable has no client behind its date; edit it directly' using errcode = '22023';
  end if;
  if d.state = 'archived' then
    raise exception 'an archived deliverable has no date to change' using errcode = '22023';
  end if;

  -- d.7a: "via the AM for now" — the account manager by scope, the same gate as the campaign's.
  if not (app.has_permission('projects', 'manage')
          and app.in_write_scope(null, null, app.deliverable_account_manager(p_deliverable))) then
    raise exception 'only the campaign''s account manager can change the promised date'
      using errcode = '42501';
  end if;

  -- I59 E5 (25 Sep): the client's agreement is ASKED for, never required. When a file is given it is
  -- still one filed in THIS campaign's folders — a wrong file is refused, a missing one is recorded.
  if p_evidence_asset is not null and not exists (
       select 1 from assets a join asset_folders f on f.id = a.folder_id
        where a.id = p_evidence_asset and a.tenant_id = v_tenant and f.campaign_id = v_campaign) then
    raise exception 'that evidence is not filed in this campaign''s folders — file it there, or change the date without it'
      using errcode = '22023', hint = 'evidence_not_in_campaign';
  end if;

  if p_due_day is null then
    raise exception 'a new date is required' using errcode = '22023';
  end if;
  v_to := app.close_of_day(p_due_day);
  if v_to is not distinct from d.due_at then
    raise exception 'that is already the promised date' using errcode = '22023';
  end if;
  -- ADR-0093: a date after go-live is not refused. The dialog says it is after go-live and that
  -- the client's agreement is needed; the override row (record_due_date_override, severity
  -- after_go_live) is the record of proceeding.

  v_prior := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  perform set_config('app.deliverable_due_at_change', 'on', true);
  update deliverables set due_at = v_to where id = p_deliverable;
  perform set_config('app.deliverable_due_at_change', v_prior, true);

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values (v_tenant, p_deliverable, 'deadline_changed', 'client', v_actor,
          jsonb_build_object('from', d.due_at, 'to', v_to, 'evidence_asset_id', p_evidence_asset,
                             'evidence_attached', p_evidence_asset is not null,
                             'note', nullif(trim(coalesce(p_note, '')), '')))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);
  return v_id;
end $$;

comment on function public.deliverable_due_at_change(uuid, date, uuid, text) is
  'ADR-0088 d.7a as relaxed by I59 E5: the route by which a live deliverable''s promised date changes. '
  'The account manager by scope, to 18:00 Iraq on the day. The client''s evidence is asked for and '
  'never required; when given it must be filed in the campaign''s folders. Logged as deadline_changed '
  'attributed to the client, with evidence_attached and evidence_asset_id.';

revoke execute on function public.deliverable_due_at_change(uuid, date, uuid, text) from public, anon;
grant  execute on function public.deliverable_due_at_change(uuid, date, uuid, text) to authenticated;

commit;
