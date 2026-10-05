-- ADR-0141 (Edward, 3 Oct) — I74.13–I74.17. Only the account manager changes a deliverable; everyone else asks through
-- one form.
--
--   d.1  WHO CHANGES. `app.may_change_deliverable`: projects:manage AND reach over the piece's account manager
--        (`in_write_scope(null, null, AM)`) — exactly `approve_campaign`'s gate: the account manager, the account
--        director, Traffic and the Power Admin. `app.may_edit_deliverable` (read by edit_piece_directly,
--        change_deliverable_type, the two previews and request_deliverable_change) now answers that. The edit guard
--        (`tg_deliverable_edit_guard`) covers name, type, quantity, channel, language and brief lines (notes), and for a
--        piece on a LIVE campaign applies the same rule; `update_piece_details` asks it too. A draft campaign's pieces and
--        ad-hoc (job) deliverables keep the old rule — they are not yet a promise to a client. Refusals carry hint
--        `ask_account_manager` and the account manager's name in DETAIL. The owner change (ADR-0128) is untouched.
--   d.2  THE ONE FORM. `deliverable_change_asks`: what isn't right (kinds), the new due date and hours, why, and — when a
--        task's move opened it — that task. One pending per piece. `ask_deliverable_change` / `withdraw_deliverable_change`
--        / `answer_deliverable_change` (accept: the asked due date applies through edit_piece_directly and the hours are
--        recorded; change: her values; keep: with her reason). The assignees of the piece's live tasks are told of an
--        applied change; the asker hears every answer.
--   d.3  Unanswered after 4 working hours it goes to the account director (escalation kind `deliverable_change`).
--   d.5  ADR-0088 is RETIRED: `sub_task_extension_request` raises no new request (hint `extension_retired`); a pending
--        one is still answered as before. A maker asks her own lead for more time instead — `sub_task_time_asks`,
--        `ask_more_time` / `answer_more_time` / `withdraw_more_time`; a yes moves the task's due day through
--        update_task_assignment AS THE LEAD and says whether it now runs past the piece's due date (the UI then opens
--        the change form, filled in).
--
-- Hours: a deliverable has NO hours column ("About 12 hours" on the piece is the sum of its live tasks' sla_hours).
-- Nothing is invented here: an accepted or changed ask RECORDS the hours (`applied_hours`) and moves no task.
--
-- Reproduced WHOLE from their latest definitions (grep -liE "function +(public|app)\.<name>\b", 3 Oct):
--   app.may_edit_deliverable              20260930120000
--   app.tg_deliverable_edit_guard         20260926132000
--   public.update_piece_details           20260930124000
--   public.change_deliverable_type        20260930120000 (via pg_get_functiondef, local stack at 20261003100000)
--   public.preview_deliverable_type_change 20260930120000 (idem)
--   public.edit_piece_directly            20260930122000 (idem)
--   public.preview_quantity_change        20260930122000 (idem)
--   public.request_deliverable_change     20260926132000 (idem)
--   public.sub_task_extension_request     20260926131000 — now a refusal only
--   app.escalation_due, app.run_escalation_sweep   20261003110000
-- Safe on a populated database: two new tables, no change to existing rows.

begin;

-- ===================================================================== d.1: who changes a deliverable ====
create or replace function app.may_change_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer cost 1000
set search_path = public, app, extensions as $$
  select app.has_permission('projects', 'manage')
     and exists (select 1 from public.deliverables d
                  where d.id = p_deliverable and d.tenant_id = app.current_tenant_id()
                    and app.in_write_scope(null, null, app.deliverable_account_manager(d.id)))
$$;
comment on function app.may_change_deliverable(uuid) is
  'ADR-0141 d.1: projects:manage and reach over the piece''s account manager — the account manager, the account '
  'director, Traffic and the Power Admin (approve_campaign''s gate). Owners and department leads ask.';
revoke execute on function app.may_change_deliverable(uuid) from public, anon;
grant  execute on function app.may_change_deliverable(uuid) to authenticated;

-- The name a refusal gives: the piece's account manager.
create or replace function app.refusal_names_deliverable_am(p_deliverable uuid)
returns text language sql stable security definer
set search_path = public, app, extensions as $$
  select p.display_name from public.user_profiles p
   where p.id = app.deliverable_account_manager(p_deliverable)
     and p.tenant_id = app.current_tenant_id()
$$;
revoke execute on function app.refusal_names_deliverable_am(uuid) from public, anon;
grant  execute on function app.refusal_names_deliverable_am(uuid) to authenticated;

-- Reproduced from 20260930120000 (its last definition). ADR-0141 d.1: the body is the account manager's gate.
create or replace function app.may_edit_deliverable(p_deliverable uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select app.may_change_deliverable(p_deliverable)
$$;
comment on function app.may_edit_deliverable(uuid) is
  'ADR-0141 d.1 (replaces ADR-0132 d.2/d.3): who may change a deliverable directly — app.may_change_deliverable. Read '
  'by edit_piece_directly, change_deliverable_type, preview_deliverable_type_change, preview_quantity_change and '
  'request_deliverable_change.';

-- A piece on a LIVE campaign is the account manager's; a draft campaign's piece and an ad-hoc job's keep the rule they
-- had (owner, account manager, or project_tasks:manage with reach over its department) — they are not yet a promise.
create or replace function app.may_edit_piece_fields(p_deliverable uuid)
returns boolean language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare d deliverables%rowtype; v_am uuid;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if not found then return false; end if;
  if exists (select 1 from streams s join campaigns c on c.id = s.campaign_id
              where s.id = d.stream_id and c.status = 'approved') then
    return app.may_change_deliverable(p_deliverable);
  end if;
  v_am := app.deliverable_account_manager(d.id);
  return coalesce(d.owner_user_id = auth.uid()
                  or v_am = auth.uid()
                  or (app.has_permission('project_tasks', 'manage') and app.in_write_scope(d.department_id, null, v_am)),
                  false);
end $$;
comment on function app.may_edit_piece_fields(uuid) is
  'ADR-0141 d.1: who may change a piece''s name, type, quantity, channel, language or brief lines — on a live campaign '
  'app.may_change_deliverable; on a draft campaign or an ad-hoc job, its owner, the account manager or the leads in reach.';
revoke execute on function app.may_edit_piece_fields(uuid) from public, anon;
grant  execute on function app.may_edit_piece_fields(uuid) to authenticated;

-- Reproduced from 20260926132000. ADR-0141 d.1: channel, language and the brief lines (notes) are guarded too, and the
-- authority is app.may_edit_piece_fields. An authorised apply (an accepted ADR-0110 change request, or the account
-- manager's own direct edit — both raise app.change_request_apply) is decided by its RPC, not here.
create or replace function app.tg_deliverable_edit_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name
     and new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity
     and new.channel is not distinct from old.channel
     and new.language is not distinct from old.language
     and new.notes is not distinct from old.notes then
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
  if coalesce(current_setting('app.change_request_apply', true), '') = 'on'
     or app.may_edit_piece_fields(old.id) then
    return new;
  end if;
  raise exception 'only the account manager changes a deliverable — ask % to change it',
          coalesce(app.refusal_names_deliverable_am(old.id), 'the account manager')
    using errcode = '42501',
          detail = coalesce(app.refusal_names_deliverable_am(old.id), ''),
          hint = 'ask_account_manager';
end $$;

comment on function app.tg_deliverable_edit_guard() is
  'ADR-0141 d.1: who may change a deliverable''s name, type, quantity, channel, language or brief lines — '
  'app.may_edit_piece_fields (the account manager''s gate on a live campaign). A blank name is refused; a type CHANGE '
  'over live tasks is refused except through an authorised apply (app.change_request_apply). Held in Postgres so a '
  'PATCH and the RPCs are governed identically.';

drop trigger if exists deliverable_edit_guard on deliverables;
create trigger deliverable_edit_guard
  before update of name, deliverable_type_id, quantity, channel, language, notes on deliverables
  for each row execute function app.tg_deliverable_edit_guard();

-- Reproduced from 20260930124000. ADR-0141 d.1: the authority is app.may_edit_piece_fields, refused in the account
-- manager's name.
create or replace function public.update_piece_details(
  p_deliverable uuid,
  p_channel     text,
  p_language    text,
  p_notes       text
) returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  d      deliverables;
  v_langs text[];
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if d.id is null then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;

  if not app.may_edit_piece_fields(d.id) then
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(d.id), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(d.id), ''),
            hint = 'ask_account_manager';
  end if;

  select c.languages into v_langs
    from streams s join campaigns c on c.id = s.campaign_id
   where s.id = d.stream_id;
  if nullif(trim(p_language), '') is not null
     and coalesce(array_length(v_langs, 1), 0) > 0
     and not (trim(p_language) = any (v_langs)) then
    raise exception 'that language is not one this campaign is made in — add it to the campaign first'
      using errcode = '22023';
  end if;

  update deliverables
     set channel  = nullif(trim(p_channel), ''),
         language = nullif(trim(p_language), ''),
         notes    = nullif(trim(p_notes), '')
   where id = d.id;
end $$;

comment on function public.update_piece_details(uuid, text, text, text) is
  'I68.2 / ADR-0141 d.1: a piece''s channel, language (one of the campaign''s) and brief lines (notes). Invoker; '
  'app.may_edit_piece_fields — the account manager''s gate on a live campaign (hint ask_account_manager).';


-- ===================================================================== d.1: the direct edits refuse in the account manager's name ====
-- public.change_deliverable_type: re-emitted whole from its live definition; the refusal is the only edit (ADR-0141 d.1).
CREATE OR REPLACE FUNCTION public.change_deliverable_type(p_deliverable uuid, p_type uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
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
end $function$;

-- public.edit_piece_directly: re-emitted whole from its live definition; the refusal is the only edit (ADR-0141 d.1).
CREATE OR REPLACE FUNCTION public.edit_piece_directly(p_deliverable uuid, p_quantity integer DEFAULT NULL::integer, p_due_day date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
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
end $function$;

-- public.preview_deliverable_type_change: re-emitted whole from its live definition; the refusal is the only edit (ADR-0141 d.1).
CREATE OR REPLACE FUNCTION public.preview_deliverable_type_change(p_deliverable uuid, p_type uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
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
end $function$;

-- public.preview_quantity_change: re-emitted whole from its live definition; the refusal is the only edit (ADR-0141 d.1).
CREATE OR REPLACE FUNCTION public.preview_quantity_change(p_deliverable uuid, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
    -- ADR-0141 d.1: only the account manager (or the account director, Traffic, the Power Admin) changes a deliverable.
    raise exception 'only the account manager changes a deliverable — ask % to change it',
            coalesce(app.refusal_names_deliverable_am(p_deliverable), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
            hint = 'ask_account_manager';
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
end $function$;

-- public.request_deliverable_change (ADR-0110, the client asking for something different): re-emitted whole from
-- its live definition. ADR-0141 d.6: raised only by the account manager — the gate (app.may_edit_deliverable) moved
-- with it; the refusal now names the account manager, not the owner.
CREATE OR REPLACE FUNCTION public.request_deliverable_change(p_deliverable uuid, p_changes jsonb, p_asked_by text, p_cost jsonb DEFAULT NULL::jsonb, p_evidence_asset uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
            app.refusal_ask(app.refusal_names_deliverable_am(p_deliverable))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(p_deliverable), ''),
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
end $function$;

-- ===================================================================== d.2: the one change form ====
create table deliverable_change_asks (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  deliverable_id   uuid not null references deliverables(id) on delete cascade,
  asked_by         uuid not null references user_profiles(id),
  -- What isn't right (CP-06): hours, due date, format or size, language, quantity, the brief is missing something,
  -- something else.
  kinds            text[] not null
                     check (cardinality(kinds) > 0
                            and kinds <@ array['hours', 'due_date', 'format', 'language', 'quantity', 'brief', 'other']::text[]),
  requested_due_day date,
  requested_hours  numeric check (requested_hours is null or requested_hours > 0),
  reason           text not null check (length(trim(reason)) > 0),
  -- The task whose move past the piece's due date opened the form, already filled in (d.2).
  from_sub_task_id uuid references sub_tasks(id) on delete set null,
  status           text not null default 'pending'
                     check (status in ('pending', 'accepted', 'changed', 'kept', 'withdrawn')),
  answered_by      uuid references user_profiles(id),
  answered_at      timestamptz,
  answer_note      text,
  -- What the answer applied: the due day (through edit_piece_directly) and the hours (recorded only — a deliverable
  -- has no hours of its own; see the header).
  applied_due_day  date,
  applied_hours    numeric,
  escalated_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid,
  updated_by       uuid,
  constraint chk_deliverable_change_asks_closed_when check ((status = 'pending') = (answered_at is null)),
  constraint chk_deliverable_change_asks_keep_has_reason
    check (status <> 'kept' or length(trim(coalesce(answer_note, ''))) > 0)
);
comment on table deliverable_change_asks is
  'ADR-0141 d.2–d.4: the one change form — anyone but the account manager asks her to change a deliverable (its hours, '
  'due date, format, language, quantity or brief). Written only by ask/withdraw/answer_deliverable_change (definer); '
  'read tenant-wide like every per-piece record.';

create index idx_deliverable_change_asks_tenant_id on deliverable_change_asks (tenant_id);
create index idx_deliverable_change_asks_deliverable_id on deliverable_change_asks (deliverable_id);
create unique index uq_deliverable_change_asks_one_pending on deliverable_change_asks (deliverable_id)
  where status = 'pending';

alter table deliverable_change_asks enable row level security;
alter table deliverable_change_asks force row level security;
create policy deliverable_change_asks_tenant_select on deliverable_change_asks
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
-- No write policy: every write is one of the three RPCs below.

create trigger audit_row_change
  after insert or update or delete on deliverable_change_asks
  for each row execute function app.audit_row_change();
create trigger set_updated_at before update on deliverable_change_asks
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on deliverable_change_asks
  for each row execute function app.set_actor_columns();

-- Table privileges (traps.md: a table created by `migration up` has none; RLS still decides every row).
grant select, insert, update, delete on table public.deliverable_change_asks to authenticated, service_role;

-- Ask. Anyone who works on the piece and may not change it: its owner, a holder of project_tasks:manage, or the
-- person on one of its live tasks. The account manager's own side changes it directly (hint change_directly).
create or replace function public.ask_deliverable_change(
  p_deliverable   uuid,
  p_kinds         text[],
  p_reason        text,
  p_due_day       date    default null,
  p_hours         numeric default null,
  p_from_sub_task uuid    default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  d      deliverables%rowtype;
  v_ask  uuid;
  v_am   uuid;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id();
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;
  if d.state = 'archived' then
    raise exception 'this deliverable is closed; there is nothing left to change' using errcode = '22023';
  end if;
  if app.may_change_deliverable(p_deliverable) then
    raise exception 'you change this deliverable yourself — there is nobody to ask' using errcode = '22023', hint = 'change_directly';
  end if;
  if not (d.owner_user_id = auth.uid()
          or app.has_permission('project_tasks', 'manage')
          or exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.assignee_id = auth.uid()
                                                  and t.status not in ('done', 'cancelled'))) then
    raise exception 'asking for a change to this deliverable is for the people working on it' using errcode = '42501';
  end if;
  if p_kinds is null or cardinality(p_kinds) = 0
     or not (p_kinds <@ array['hours', 'due_date', 'format', 'language', 'quantity', 'brief', 'other']::text[]) then
    raise exception 'say what isn''t right — hours, due date, format, language, quantity, brief or something else'
      using errcode = '22023', hint = 'kinds_required';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why — the reason goes to the account manager' using errcode = '22023', hint = 'reason_required';
  end if;
  if p_hours is not null and p_hours <= 0 then
    raise exception 'the hours asked for are more than nothing' using errcode = '22023';
  end if;
  if p_from_sub_task is not null and not exists (select 1 from sub_tasks t where t.id = p_from_sub_task and t.deliverable_id = d.id) then
    raise exception 'that task is not one of this deliverable''s' using errcode = '22023';
  end if;
  if exists (select 1 from deliverable_change_asks a where a.deliverable_id = d.id and a.status = 'pending') then
    raise exception 'a change to this deliverable is already waiting on the account manager'
      using errcode = '22023', hint = 'change_pending';
  end if;

  insert into deliverable_change_asks (tenant_id, deliverable_id, asked_by, kinds, requested_due_day, requested_hours,
                                       reason, from_sub_task_id)
  values (d.tenant_id, d.id, auth.uid(), p_kinds, p_due_day, p_hours, trim(p_reason), p_from_sub_task)
  returning id into v_ask;

  v_am := app.deliverable_account_manager(d.id);
  if v_am is not null and v_am is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, v_am, 'deliverable_change_asked', d.name, 'deliverable', d.id, auth.uid(),
            jsonb_build_object('ask_id', v_ask, 'kinds', to_jsonb(p_kinds), 'due_day', p_due_day, 'hours', p_hours,
                               'reason', trim(p_reason), 'from_sub_task', p_from_sub_task));
  end if;
  return v_ask;
end $$;
comment on function public.ask_deliverable_change(uuid, text[], text, date, numeric, uuid) is
  'ADR-0141 d.2: ask the account manager to change a deliverable — what isn''t right, the new due day and hours, why, '
  'and the task whose move opened it. One pending per piece (hint change_pending); the account manager''s side is told '
  'to change it directly (hint change_directly).';
revoke execute on function public.ask_deliverable_change(uuid, text[], text, date, numeric, uuid) from public, anon;
grant  execute on function public.ask_deliverable_change(uuid, text[], text, date, numeric, uuid) to authenticated;

create or replace function public.withdraw_deliverable_change(p_ask uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare a deliverable_change_asks%rowtype; v_am uuid;
begin
  select * into a from deliverable_change_asks where id = p_ask and tenant_id = app.current_tenant_id();
  if not found then raise exception 'change ask % not found', p_ask using errcode = 'P0002'; end if;
  if a.asked_by is distinct from auth.uid() then
    raise exception 'only the person who asked can withdraw it' using errcode = '42501';
  end if;
  if a.status <> 'pending' then return; end if;
  update deliverable_change_asks set status = 'withdrawn', answered_at = now() where id = p_ask;
  v_am := app.deliverable_account_manager(a.deliverable_id);
  if v_am is not null and v_am is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (a.tenant_id, v_am, 'deliverable_change_withdrawn',
            (select d.name from deliverables d where d.id = a.deliverable_id), 'deliverable', a.deliverable_id, auth.uid(),
            jsonb_build_object('ask_id', a.id));
  end if;
end $$;
comment on function public.withdraw_deliverable_change(uuid) is
  'ADR-0141 d.3: the asker takes a waiting change back; the account manager is told. Idempotent on a closed ask.';
revoke execute on function public.withdraw_deliverable_change(uuid) from public, anon;
grant  execute on function public.withdraw_deliverable_change(uuid) to authenticated;

-- Answer: accept (the asked due day applies; the hours are recorded), change (her values), keep (with her reason).
create or replace function public.answer_deliverable_change(
  p_ask     uuid,
  p_answer  text,
  p_due_day date    default null,
  p_hours   numeric default null,
  p_note    text    default null)
returns jsonb
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  a       deliverable_change_asks%rowtype;
  d       deliverables%rowtype;
  v_due   date;
  v_hours numeric;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_by    text;
  v_moved boolean := false;
begin
  select * into a from deliverable_change_asks where id = p_ask and tenant_id = app.current_tenant_id() for update;
  if not found then raise exception 'change ask % not found', p_ask using errcode = 'P0002'; end if;
  if p_answer is null or p_answer not in ('accept', 'change', 'keep') then
    raise exception 'the answer is accept, change or keep' using errcode = '22023';
  end if;
  if a.status <> 'pending' then
    select up.display_name into v_by from user_profiles up where up.id = a.answered_by;
    raise exception 'this change has already been answered (%)%', a.status,
            case when v_by is null then '' else ' by ' || v_by end
      using errcode = '22023', hint = 'request_settled';
  end if;
  if not app.may_change_deliverable(a.deliverable_id) then
    raise exception 'only the account manager answers a change to this deliverable — % can',
            coalesce(app.refusal_names_deliverable_am(a.deliverable_id), 'the account manager')
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_am(a.deliverable_id), ''),
            hint = 'ask_account_manager';
  end if;
  select * into d from deliverables where id = a.deliverable_id;

  if p_answer = 'keep' then
    if v_note is null then
      raise exception 'say why it stays as it is — the reason goes to the person who asked'
        using errcode = '22023', hint = 'reason_required';
    end if;
    update deliverable_change_asks
       set status = 'kept', answered_by = auth.uid(), answered_at = now(), answer_note = v_note
     where id = p_ask;
  else
    v_due   := case when p_answer = 'accept' then a.requested_due_day else coalesce(p_due_day, a.requested_due_day) end;
    v_hours := case when p_answer = 'accept' then a.requested_hours   else coalesce(p_hours, a.requested_hours) end;
    if v_due is not null and app.close_of_day(v_due) is distinct from d.due_at then
      -- The same write the account manager's own direct edit makes: the fence, the deadline log, the owner told.
      perform public.edit_piece_directly(d.id, null, v_due);
      v_moved := true;
    end if;
    update deliverable_change_asks
       set status = case when p_answer = 'accept' then 'accepted' else 'changed' end,
           answered_by = auth.uid(), answered_at = now(), answer_note = v_note,
           applied_due_day = v_due, applied_hours = v_hours
     where id = p_ask;
    -- CP-08: the assignees are told what changed.
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select distinct d.tenant_id, t.assignee_id, 'deliverable_edited', d.name, 'deliverable', d.id, auth.uid(),
           jsonb_build_object('ask_id', a.id, 'due_day', v_due, 'hours', v_hours, 'note', v_note)
      from sub_tasks t
     where t.deliverable_id = d.id and t.assignee_id is not null and t.status not in ('done', 'cancelled')
       and t.assignee_id is distinct from auth.uid() and t.assignee_id is distinct from a.asked_by;
  end if;

  if a.asked_by is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (a.tenant_id, a.asked_by, 'deliverable_change_answered', d.name, 'deliverable', d.id, auth.uid(),
            jsonb_build_object('ask_id', a.id, 'answer', p_answer, 'due_day', v_due, 'hours', v_hours, 'note', v_note));
  end if;

  return jsonb_build_object('ask_id', a.id, 'answer', p_answer, 'due_day', v_due, 'hours', v_hours, 'due_moved', v_moved);
end $$;
comment on function public.answer_deliverable_change(uuid, text, date, numeric, text) is
  'ADR-0141 d.4: the account manager (app.may_change_deliverable) answers — accept (the asked due day applies through '
  'edit_piece_directly; the hours are recorded), change (her values), keep (her reason required). The asker and the '
  'piece''s assignees are told. Hints: request_settled, ask_account_manager, reason_required.';
revoke execute on function public.answer_deliverable_change(uuid, text, date, numeric, text) from public, anon;
grant  execute on function public.answer_deliverable_change(uuid, text, date, numeric, text) to authenticated;

-- ===================================================================== d.5: ADR-0088 retired ====
-- Reproduced from 20260926131000 (its last definition) as a refusal: no new extension request is raised. A request
-- already pending is still answered by sub_task_extension_decide, unchanged.
create or replace function public.sub_task_extension_request(p_sub_task uuid, p_to_day date, p_reason text, p_attributed_to text)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  raise exception 'deadline extensions are retired — ask your lead for more time, or ask the account manager to change the piece'
    using errcode = '22023', hint = 'extension_retired';
end $$;
comment on function public.sub_task_extension_request(uuid, date, text, text) is
  'ADR-0141 d.5: retired — raises hint extension_retired. A maker asks her lead (ask_more_time); a piece''s date is '
  'asked of the account manager (ask_deliverable_change). Pending ADR-0088 requests are still decided as before.';

-- ===================================================================== d.5: a maker asks her lead for more time ====
create table sub_task_time_asks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id),
  sub_task_id  uuid not null,
  asked_by     uuid not null references user_profiles(id),
  to_day       date not null,
  note         text,
  status       text not null default 'pending' check (status in ('pending', 'given', 'refused', 'withdrawn', 'superseded')),
  answered_by  uuid references user_profiles(id),
  answered_at  timestamptz,
  answer_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,
  updated_by   uuid,
  constraint fk_sub_task_time_asks_sub_task
    foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id) on delete cascade,
  constraint chk_sub_task_time_asks_closed_when check ((status = 'pending') = (answered_at is null))
);
comment on table sub_task_time_asks is
  'ADR-0141 d.5: a maker asks her own lead for more time on her task ("Lujain wants Wednesday too", SC-01). Written only '
  'by ask/answer/withdraw_more_time (definer); read tenant-wide.';
create index idx_sub_task_time_asks_tenant_id on sub_task_time_asks (tenant_id);
create index idx_sub_task_time_asks_sub_task_id on sub_task_time_asks (sub_task_id);
create unique index uq_sub_task_time_asks_one_pending on sub_task_time_asks (sub_task_id) where status = 'pending';

alter table sub_task_time_asks enable row level security;
alter table sub_task_time_asks force row level security;
create policy sub_task_time_asks_tenant_select on sub_task_time_asks
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create trigger audit_row_change
  after insert or update or delete on sub_task_time_asks
  for each row execute function app.audit_row_change();
create trigger set_updated_at before update on sub_task_time_asks
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on sub_task_time_asks
  for each row execute function app.set_actor_columns();

grant select, insert, update, delete on table public.sub_task_time_asks to authenticated, service_role;

-- Who answers a maker: her team's lead (the deputy when the lead is on leave), else her department lead
-- (app.task_request_answerers, ADR-0139 d.3); and anyone who may schedule her with bookings:create (her department
-- lead, Traffic). Never the maker.
create or replace function app.may_answer_time_ask(p_ask uuid)
returns boolean language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (
    select 1 from public.sub_task_time_asks a
      join public.sub_tasks t on t.id = a.sub_task_id
     where a.id = p_ask and a.tenant_id = app.current_tenant_id()
       and a.asked_by is distinct from auth.uid()
       and (auth.uid() in (select x.user_id from app.task_request_answerers(
                             app.task_request_team(null, a.asked_by), app.task_request_department(null, a.asked_by)) x)
            or (app.has_permission('bookings', 'create')
                and exists (select 1 from public.resources r
                             where r.user_id = a.asked_by and r.kind = 'human' and r.is_active
                               and app.resource_in_scheduling_scope(r.id)))))
$$;
revoke execute on function app.may_answer_time_ask(uuid) from public, anon;
grant  execute on function app.may_answer_time_ask(uuid) to authenticated;

create or replace function public.ask_more_time(p_sub_task uuid, p_to_day date, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v sub_tasks%rowtype; v_ask uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;
  if v.assignee_id is distinct from auth.uid() then
    raise exception 'only the person doing the task asks for more time on it' using errcode = '42501';
  end if;
  if v.status in ('done', 'cancelled') then
    raise exception '"%" is finished or called off', v.title using errcode = '22023';
  end if;
  if p_to_day is null or p_to_day < (now() at time zone 'Asia/Baghdad')::date then
    raise exception 'choose a day from today on' using errcode = '22023', hint = 'day_required';
  end if;
  if v.due_at is not null and app.close_of_day(p_to_day) <= v.due_at then
    raise exception 'that is not more time — the task is already due by then' using errcode = '22023';
  end if;
  if exists (select 1 from sub_task_time_asks a where a.sub_task_id = p_sub_task and a.status = 'pending') then
    raise exception 'you have already asked for more time on this task' using errcode = '22023', hint = 'request_pending';
  end if;

  insert into sub_task_time_asks (tenant_id, sub_task_id, asked_by, to_day, note)
  values (v.tenant_id, v.id, auth.uid(), p_to_day, nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_ask;

  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v.tenant_id, x.user_id, 'time_asked', v.title, 'sub_task', v.id, auth.uid(),
         jsonb_build_object('ask_id', v_ask, 'to_day', p_to_day, 'due_at', v.due_at,
                            'note', nullif(trim(coalesce(p_note, '')), ''))
    from app.task_request_answerers(app.task_request_team(null, auth.uid()), app.task_request_department(null, auth.uid())) x
   where x.user_id is distinct from auth.uid();
  return v_ask;
end $$;
comment on function public.ask_more_time(uuid, date, text) is
  'ADR-0141 d.5: the maker asks her own lead to move her task''s due day to p_to_day. One pending per task '
  '(hint request_pending). Her team lead (or deputy, or department lead) is told.';
revoke execute on function public.ask_more_time(uuid, date, text) from public, anon;
grant  execute on function public.ask_more_time(uuid, date, text) to authenticated;

create or replace function public.withdraw_more_time(p_ask uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare a sub_task_time_asks%rowtype;
begin
  select * into a from sub_task_time_asks where id = p_ask and tenant_id = app.current_tenant_id();
  if not found then raise exception 'time ask % not found', p_ask using errcode = 'P0002'; end if;
  if a.asked_by is distinct from auth.uid() then
    raise exception 'only the person who asked can withdraw it' using errcode = '42501';
  end if;
  if a.status <> 'pending' then return; end if;
  update sub_task_time_asks set status = 'withdrawn', answered_at = now() where id = p_ask;
end $$;
revoke execute on function public.withdraw_more_time(uuid) from public, anon;
grant  execute on function public.withdraw_more_time(uuid) to authenticated;

-- The lead's answer. A yes moves the task's due day through update_task_assignment AS THE LEAD (the maker asked, so a
-- started task moves without the confirmation step) and says whether it now runs past the piece's own due date — the
-- client then opens the change form, filled in (ADR-0141 d.5).
create or replace function public.answer_more_time(p_ask uuid, p_give boolean, p_note text default null)
returns table(sub_task_id uuid, reschedule_needed boolean, past_piece_due boolean, outcome text)
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  a       sub_task_time_asks%rowtype;
  v       sub_tasks%rowtype;
  v_due   timestamptz;
  v_piece timestamptz;
  v_r     record;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
begin
  select * into a from sub_task_time_asks where id = p_ask and tenant_id = app.current_tenant_id() for update;
  if not found then raise exception 'time ask % not found', p_ask using errcode = 'P0002'; end if;
  if a.status <> 'pending' then
    raise exception 'this has already been answered (%)', a.status using errcode = '22023', hint = 'request_settled';
  end if;
  if not app.may_answer_time_ask(p_ask) then
    raise exception 'more time on this task is given by the person''s own lead' using errcode = '42501', hint = 'not_the_answerer';
  end if;
  select * into v from sub_tasks where id = a.sub_task_id;

  if not coalesce(p_give, false) then
    if v_note is null then
      raise exception 'say why — the reason goes to the person who asked' using errcode = '22023', hint = 'reason_required';
    end if;
    update sub_task_time_asks set status = 'refused', answered_by = auth.uid(), answered_at = now(), answer_note = v_note
     where id = p_ask;
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (a.tenant_id, a.asked_by, 'time_answered', v.title, 'sub_task', v.id, auth.uid(),
            jsonb_build_object('ask_id', a.id, 'given', false, 'to_day', a.to_day, 'note', v_note));
    sub_task_id := v.id; reschedule_needed := false; past_piece_due := false; outcome := 'refused';
    return next; return;
  end if;

  if v.assignee_id is distinct from a.asked_by or v.status in ('done', 'cancelled') then
    update sub_task_time_asks set status = 'superseded', answered_at = now() where id = p_ask;
    raise exception 'the task is no longer theirs to do — nothing to give' using errcode = '22023', hint = 'request_settled';
  end if;

  v_due := app.close_of_day(a.to_day);
  update sub_task_time_asks set status = 'given', answered_by = auth.uid(), answered_at = now(), answer_note = v_note
   where id = p_ask;
  select * into v_r from public.update_task_assignment(v.id, v.title, v.assignee_id, null, null, v_due, null, null, true) u;
  if v_r.outcome is distinct from 'assigned' then
    raise exception 'giving the time did not move the task' using errcode = '55000';
  end if;

  select d.due_at into v_piece from deliverables d where d.id = v.deliverable_id;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  values (a.tenant_id, a.asked_by, 'time_answered', v.title, 'sub_task', v.id, auth.uid(),
          jsonb_build_object('ask_id', a.id, 'given', true, 'to_day', a.to_day, 'note', v_note));

  sub_task_id := v.id;
  reschedule_needed := coalesce(v_r.reschedule_needed, true);
  past_piece_due := v_piece is not null and v_due > v_piece;
  outcome := 'given';
  return next;
end $$;
comment on function public.answer_more_time(uuid, boolean, text) is
  'ADR-0141 d.5: the maker''s lead (app.may_answer_time_ask) gives the time — the task''s due day moves through '
  'update_task_assignment as the lead; past_piece_due says when it now runs past the piece''s due date (open the change '
  'form) — or says no with a reason. The maker is told. Hints: request_settled, not_the_answerer, reason_required.';
revoke execute on function public.answer_more_time(uuid, boolean, text) from public, anon;
grant  execute on function public.answer_more_time(uuid, boolean, text) to authenticated;

-- ===================================================================== d.3: the change form escalates ====
-- Re-emitted from 20261003110000; the deliverable_change arm is the edit.
CREATE OR REPLACE FUNCTION app.escalation_due(p_now timestamp with time zone DEFAULT now())
 RETURNS SETOF app.escalation_due_row
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ---- unassigned (ADR-0108 d.2 row 1, d.4; I59 settled: every piece from its task list's approval) ----
  select d.tenant_id, 'unassigned', d.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         d.tasks_approved_at, app.elapsed_hours(d.tasks_approved_at, p_now), r.hours,
         jsonb_build_object('unassigned', u.n, 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'unassigned'
    cross join lateral (select count(*)::int as n from sub_tasks t
                         where t.deliverable_id = d.id and t.assignee_id is null
                           and t.status in ('todo', 'in_progress', 'blocked', 'review')) u
   where c.status = 'approved'
     and c.kind in ('single_job', 'campaign')
     and d.tasks_approved_at is not null
     and d.state not in ('archived', 'delivered')
     and u.n > 0
     and app.elapsed_hours(d.tasks_approved_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'unassigned'
                        and l.subject_id = d.id and l.occurrence = '')

  union all
  -- ---- task_list: the piece's task list, waiting on its owner (ADR-0090 / ADR-0100) ----
  select d.tenant_id, 'task_list', d.id, coalesce(d.task_list_reopened_at::text, ''), 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at),
         app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id),
                            -- I66.4: a piece with no live task has no list to approve — its tasks were never
                            -- defined, and the escalation says that instead of "waited for approval".
                            'no_tasks', not exists (select 1 from sub_tasks t where t.deliverable_id = d.id
                                                                             and t.status not in ('done', 'cancelled')))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
   where c.status = 'approved'
     and c.approved_at is not null
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     -- ADR-0119 d.1/d.3: every campaign; one approved before the cut-over is timed from this release.
     and app.elapsed_hours(app.task_list_waiting_since(c.kind, c.approved_at, d.task_list_reopened_at), p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = coalesce(d.task_list_reopened_at::text, ''))
     -- I66.11: every task cancelled has its own rung, below.
     and not (exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled'))

  union all
  -- ---- task_list, every task cancelled (I66.11): the owner has not added a task or closed the piece. The same
  -- rung's hours and recipients, counted from the last cancellation; `occurrence` is that moment, so a piece
  -- cancelled again later escalates again. ----
  select d.tenant_id, 'task_list', d.id, 'all_cancelled:' || x.last_cancel::text, 'deliverable', d.id, d.name, d.id, null::uuid, c.id,
         x.last_cancel, app.elapsed_hours(x.last_cancel, p_now), r.hours,
         jsonb_build_object('waiting_on', 'task_list', 'campaign_kind', c.kind, 'all_cancelled', true,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverables d
    join streams st on st.id = d.stream_id
    join campaigns c on c.id = st.campaign_id
    join tenant_escalation_rules r on r.tenant_id = d.tenant_id and r.kind = 'task_list'
    cross join lateral (select max(t.updated_at) as last_cancel from sub_tasks t where t.deliverable_id = d.id) x
   where c.status = 'approved'
     and d.state not in ('archived', 'approved', 'delivered')
     and exists (select 1 from sub_tasks t where t.deliverable_id = d.id) and not exists (select 1 from sub_tasks t where t.deliverable_id = d.id and t.status <> 'cancelled')
     and app.elapsed_hours(x.last_cancel, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = d.tenant_id and l.kind = 'task_list'
                        and l.subject_id = d.id and l.occurrence = 'all_cancelled:' || x.last_cancel::text)

  union all
  -- ---- campaign_brief (I59 E8): the campaign's brief, waiting on the account manager (ADR-0048 d.9) ----
  select c.tenant_id, 'campaign_brief', c.id, c.submitted_at::text, 'campaign', c.id, c.name, null::uuid, null::uuid, c.id,
         c.submitted_at, app.elapsed_hours(c.submitted_at, p_now), r.hours,
         jsonb_build_object('waiting_on', 'campaign_brief', 'campaign_kind', c.kind)
    from campaigns c
    join tenant_escalation_rules r on r.tenant_id = c.tenant_id and r.kind = 'campaign_brief'
   where c.status = 'pending_approval'
     and c.submitted_at is not null
     and app.elapsed_hours(c.submitted_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = c.tenant_id and l.kind = 'campaign_brief'
                        and l.subject_id = c.id and l.occurrence = c.submitted_at::text)

  union all
  -- ---- review_remind / review_escalate: a round sent and not answered (ADR-0043 / ADR-0089) ----
  select t.tenant_id, r.kind, t.id, t.revision_number::text, 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         s.since, app.elapsed_hours(s.since, p_now), r.hours,
         jsonb_build_object('round', t.revision_number + 1,
                            'outstanding', (select count(*) from sub_task_reviewers rv
                                             where rv.sub_task_id = t.id
                                               and rv.approved_at is null and rv.responded_at is null),
                            'deliverable', d.name)
    from sub_tasks t
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = t.tenant_id and r.kind in ('review_remind', 'review_escalate')
    cross join lateral (select max(e.submitted_at) as since from task_time_entries e
                         where e.sub_task_id = t.id and e.round = t.revision_number) s
   where t.status = 'review'
     and s.since is not null
     and exists (select 1 from sub_task_reviewers rv
                  where rv.sub_task_id = t.id and rv.approved_at is null and rv.responded_at is null)
     and app.elapsed_hours(s.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = t.tenant_id and l.kind = r.kind
                        and l.subject_id = t.id and l.occurrence = t.revision_number::text)

  union all
  -- ---- over_capacity (ADR-0108 d.6) ----
  select w.tenant_id, 'over_capacity', w.resource_id, w.week_start::text, 'resource', w.resource_id, w.name,
         null::uuid, null::uuid, null::uuid, (w.week_start::timestamp at time zone 'UTC'), null::numeric,
         coalesce(s.over_capacity_pct, 110),
         jsonb_build_object('booked_hours', w.booked_hours, 'nominal_hours', w.nominal_hours,
                            'util_pct', w.util_pct, 'over_capacity_pct', coalesce(s.over_capacity_pct, 110),
                            'week_start', w.week_start, 'booking_count', w.booking_count)
    from app.week_load(p_now) w
    left join tenant_reminder_settings s on s.tenant_id = w.tenant_id
   where w.util_pct > coalesce(s.over_capacity_pct, 110)
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = w.tenant_id and l.kind = 'over_capacity'
                        and l.subject_id = w.resource_id and l.occurrence = w.week_start::text)

  union all
  -- ---- change_request (ADR-0110; hook): pending on its owner, from when it was sent ----
  select q.tenant_id, 'change_request', q.id, '', 'deliverable', d.id, d.name, d.id, null::uuid, st.campaign_id,
         q.created_at, app.elapsed_hours(q.created_at, p_now), r.hours,
         jsonb_build_object('change_request_id', q.id, 'changes', q.changes, 'asked_by', q.asked_by,
                            'owner', (select display_name from user_profiles where id = d.owner_user_id))
    from deliverable_change_requests q
    join deliverables d on d.id = q.deliverable_id
    left join streams st on st.id = d.stream_id
    join tenant_escalation_rules r on r.tenant_id = q.tenant_id and r.kind = 'change_request'
   where q.status = 'pending'
     and d.state <> 'archived'
     and app.elapsed_hours(q.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = q.tenant_id and l.kind = 'change_request'
                        and l.subject_id = q.id and l.occurrence = '')

  union all
  -- ---- extension_owner / extension_am (ADR-0109; hooks): the step the request waits at ----
  select x.tenant_id, k.kind, x.request_id, '', 'sub_task', x.sub_task_id, x.task_title, x.deliverable_id,
         x.sub_task_id, x.campaign_id,
         k.since, app.elapsed_hours(k.since, p_now), r.hours,
         jsonb_build_object('request_id', x.request_id, 'stage', x.stage, 'from', x.from_at, 'to', x.to_at,
                            'deliverable', x.deliverable_name, 'owner', x.owner_name)
    from public.sub_task_extension_requests x
    cross join lateral (
      select case when x.stage = 'owner' then 'extension_owner' else 'extension_am' end as kind,
             case when x.stage = 'owner' then x.created_at else coalesce(x.forwarded_at, x.created_at) end as since
    ) k
    join tenant_escalation_rules r on r.tenant_id = x.tenant_id and r.kind = k.kind
   where x.stage in ('owner', 'am')
     and app.elapsed_hours(k.since, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = x.tenant_id and l.kind = k.kind
                        and l.subject_id = x.request_id and l.occurrence = '')

  union all
  -- ---- blocked (ADR-0107; hook): a maker's input on their own task, not cleared, from when raised ----
  select pin.tenant_id, 'blocked', pin.id, '', 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         pin.requested_at, app.elapsed_hours(pin.requested_at, p_now), r.hours,
         jsonb_build_object('input_id', pin.id, 'kind_of_input', pin.kind, 'awaited_from', pin.awaited_from,
                            'description', pin.description, 'deliverable', d.name)
    from deliverable_pending_inputs pin
    join sub_tasks t on t.id = pin.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = pin.tenant_id and r.kind = 'blocked'
   where pin.satisfied_at is null
     and t.status not in ('done', 'cancelled')
     and app.elapsed_hours(pin.requested_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = pin.tenant_id and l.kind = 'blocked'
                        and l.subject_id = pin.id and l.occurrence = '')

  union all
  -- ---- handover (ADR-0133 d.5, I70.6): a leaving person's work not all handed on, from when they started leaving.
  -- `occurrence` is that moment, so a person who leaves again later escalates again. ----
  select up.tenant_id, 'handover', up.id, up.leaving_since::text, 'user_profile', up.id, up.display_name,
         null::uuid, null::uuid, null::uuid,
         up.leaving_since, app.elapsed_hours(up.leaving_since, p_now), r.hours,
         jsonb_build_object('user_id', up.id, 'name', up.display_name,
                            'items', app.handover_item_counts(up.id), 'total', app.handover_item_total(up.id))
    from user_profiles up
    join tenant_escalation_rules r on r.tenant_id = up.tenant_id and r.kind = 'handover'
   where up.leaving_since is not null
     and up.is_active
     and app.elapsed_hours(up.leaving_since, p_now) >= r.hours
     and app.handover_item_total(up.id) > 0
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = up.tenant_id and l.kind = 'handover'
                        and l.subject_id = up.id and l.occurrence = up.leaving_since::text)

  union all
  -- ---- task_request (ADR-0139 d.5): a booking asked of another team, unanswered, in WORKING hours from when it was
  -- asked. Once only per request (`occurrence` ''); the sweep stamps `escalated_at`. ----
  select q.tenant_id, 'task_request', q.id, '', 'sub_task', t.id, t.title, t.deliverable_id, t.id,
         coalesce(st.campaign_id, j.campaign_id),
         q.created_at, app.working_hours_between(q.created_at, p_now), r.hours,
         jsonb_build_object('request_id', q.id,
                            'team', (select tm.name from teams tm where tm.id = app.task_request_team(q.team_id, q.assignee_id)),
                            'person', (select up.display_name from user_profiles up where up.id = q.assignee_id),
                            'asked_by', (select up.display_name from user_profiles up where up.id = q.requested_by),
                            'needed_by', q.needed_by, 'deliverable', d.name)
    from sub_task_assignment_requests q
    join sub_tasks t on t.id = q.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = q.tenant_id and r.kind = 'task_request'
   where q.status = 'pending'
     and q.escalated_at is null
     and app.working_hours_between(q.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = q.tenant_id and l.kind = 'task_request'
                        and l.subject_id = q.id and l.occurrence = '')

  union all
  -- ---- deliverable_change (ADR-0141 d.3): a change asked of the account manager, unanswered, in WORKING hours from when
  -- it was asked. Once per ask; the sweep stamps `escalated_at`. Recipients: the rule's roles (the account director). ----
  select a.tenant_id, 'deliverable_change', a.id, '', 'deliverable', d.id, d.name, d.id, null::uuid,
         coalesce(st.campaign_id, j.campaign_id),
         a.created_at, app.working_hours_between(a.created_at, p_now), r.hours,
         jsonb_build_object('ask_id', a.id, 'kinds', to_jsonb(a.kinds), 'due_day', a.requested_due_day,
                            'hours_asked', a.requested_hours, 'reason', a.reason,
                            'asked_by', (select up.display_name from user_profiles up where up.id = a.asked_by))
    from deliverable_change_asks a
    join deliverables d on d.id = a.deliverable_id
    left join streams st on st.id = d.stream_id
    left join jobs j on j.id = d.job_id
    join tenant_escalation_rules r on r.tenant_id = a.tenant_id and r.kind = 'deliverable_change'
   where a.status = 'pending'
     and a.escalated_at is null
     and d.state <> 'archived'
     and app.working_hours_between(a.created_at, p_now) >= r.hours
     and not exists (select 1 from escalation_log l
                      where l.tenant_id = a.tenant_id and l.kind = 'deliverable_change'
                        and l.subject_id = a.id and l.occurrence = '');
$function$;

-- Re-emitted from 20261003110000; the deliverable_change stamp is the edit.
CREATE OR REPLACE FUNCTION app.run_escalation_sweep(p_now timestamp with time zone DEFAULT now(), p_dry_run boolean DEFAULT false, p_kind text DEFAULT NULL::text, p_deliverable uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  r          app.escalation_due_row;
  v_people   jsonb;
  v_count    integer;
  v_log      uuid;
  v_type     text;
  v_sent     integer := 0;
  v_items    jsonb := '[]'::jsonb;
  v_fallback boolean;
  v_reason   text;
begin
  -- ADR-0133 d.4: a list emptied from the items' own pages (not the hand-over page) completes here too.
  if not p_dry_run then
    perform app.complete_finished_handovers();
  end if;

  for r in select * from app.escalation_due(p_now) e where (p_kind is null or e.kind = p_kind)
             and (p_deliverable is null or e.deliverable_id = p_deliverable)   -- [edit]
           order by e.kind, e.since, e.subject_id loop
    v_fallback := false;
    v_reason := null;
    if r.kind = 'over_capacity' then
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.over_capacity_recipients(r.subject_id) x;
    elsif r.kind = 'handover' then
      -- ADR-0133 d.5: the rule's roles (default the Traffic Manager and the Power Admins), active and not leaving
      -- themselves, never the person leaving. The rule names no piece, so `escalation_recipients` does not apply.
      select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('role')) order by up.id), '[]'::jsonb)
        into v_people
        from user_profiles up
        join tenant_escalation_rules er on er.tenant_id = r.tenant_id and er.kind = 'handover'
       where up.tenant_id = r.tenant_id and up.role_id = any (er.role_ids)
         and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := 'no one holds the hand-over rule''s roles';
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active and up.leaving_since is null and up.id <> r.subject_id;
      end if;
    elsif r.kind = 'task_request' then
      -- ADR-0139 d.5: the rule's roles (default Traffic) AND the department lead the request waits on — both, always;
      -- never the asker. Falls back to the Traffic Manager like every other rung.
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people
        from (select f.user_id, array_agg(distinct f.reason order by f.reason) as reasons
                from (select up.id as user_id, 'role'::text as reason
                        from user_profiles up
                        join tenant_escalation_rules er on er.tenant_id = r.tenant_id and er.kind = 'task_request'
                       where up.tenant_id = r.tenant_id and up.role_id = any (er.role_ids) and up.is_active
                      union all
                      select up.id, 'department_lead'
                        from sub_task_assignment_requests q
                        join user_profiles up on up.tenant_id = q.tenant_id and up.is_active
                        join roles ro on ro.id = up.role_id and ro.scope = 'department'
                       where q.id = r.subject_id
                         and up.department_id = app.task_request_department(q.team_id, q.assignee_id)) f
               where f.user_id is distinct from (select q.requested_by from sub_task_assignment_requests q where q.id = r.subject_id)
               group by f.user_id) x;
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := 'no one holds the task-request rule''s roles and the department has no lead';
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    else
      select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'reasons', x.reasons) order by x.user_id), '[]'::jsonb)
        into v_people from app.escalation_recipients(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id) x;

      -- I59 E9: a rule that resolves to nobody goes to the Traffic Manager role.
      if jsonb_array_length(v_people) = 0 then
        v_fallback := true;
        v_reason := app.escalation_fallback_reason(r.kind, r.deliverable_id, r.sub_task_id, r.campaign_id);
        select coalesce(jsonb_agg(jsonb_build_object('user_id', up.id, 'reasons', jsonb_build_array('traffic_fallback'))
                                  order by up.id), '[]'::jsonb)
          into v_people
          from user_profiles up
          join roles ro on ro.id = up.role_id
         where up.tenant_id = r.tenant_id and ro.tenant_id = r.tenant_id
           and ro.key = 'scheduler' and up.is_active;
      end if;
    end if;
    v_count := jsonb_array_length(v_people);

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'kind', r.kind, 'entity_type', r.entity_type, 'entity_id', r.entity_id, 'label', r.label,
      'occurrence', r.occurrence, 'since', r.since, 'hours', round(r.hours, 1), 'threshold', r.threshold,
      'recipients', v_people, 'extra', r.extra,
      'fallback', v_fallback, 'fallback_reason', v_reason));

    if p_dry_run then
      continue;
    end if;

    if v_count = 0 then
      -- Nobody at all, not even the Traffic Manager: nothing sent, retried next run — but recorded.
      insert into escalation_unreached (tenant_id, kind, subject_id, occurrence, reason, first_tried_at, last_tried_at)
      values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_reason, p_now, p_now)
      on conflict (tenant_id, kind, subject_id, occurrence)
      do update set last_tried_at = excluded.last_tried_at, reason = excluded.reason;
      continue;
    end if;

    v_log := null;
    insert into escalation_log (tenant_id, kind, subject_id, occurrence, recipients, sent_at, fallback, fallback_reason)
    values (r.tenant_id, r.kind, r.subject_id, r.occurrence, v_count, p_now, v_fallback, v_reason)
    on conflict (tenant_id, kind, subject_id, occurrence) do nothing
    returning id into v_log;
    if v_log is null then
      continue;   -- another run sent this cause first
    end if;

    delete from escalation_unreached u
     where u.tenant_id = r.tenant_id and u.kind = r.kind and u.subject_id = r.subject_id
       and u.occurrence = r.occurrence;

    v_type := case r.kind when 'review_remind' then 'review_reminder'
                          when 'over_capacity' then 'over_capacity'
                          else 'escalated' end;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select r.tenant_id, (p ->> 'user_id')::uuid, v_type, r.label, r.entity_type, r.entity_id, null,
           coalesce(r.extra, '{}'::jsonb) || jsonb_build_object(
             'kind', r.kind, 'occurrence', r.occurrence, 'since', r.since,
             'hours', case when r.hours is null then null else round(r.hours) end,
             'threshold', r.threshold, 'as', p -> 'reasons')
           || case when v_fallback then jsonb_build_object('fallback_reason', v_reason) else '{}'::jsonb end
      from jsonb_array_elements(v_people) p;

    -- The single-job rung's own stamp keeps its meaning ("when the unassigned escalation was sent").
    if r.kind = 'unassigned' then
      update deliverables set assignment_escalated_at = p_now
       where id = r.subject_id and assignment_escalated_at is null;
    end if;
    -- ADR-0139 d.5: from now Traffic and the department lead may answer the request too.
    if r.kind = 'task_request' then
      update sub_task_assignment_requests set escalated_at = p_now
       where id = r.subject_id and escalated_at is null;
    end if;
    -- ADR-0141 d.3: the account director has it now.
    if r.kind = 'deliverable_change' then
      update deliverable_change_asks set escalated_at = p_now
       where id = r.subject_id and escalated_at is null;
    end if;

    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'now', p_now, 'sent', v_sent,
                            'due', jsonb_array_length(v_items), 'items', v_items);
end $function$;

commit;
