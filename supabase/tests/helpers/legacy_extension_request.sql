-- A deadline-extension request as ADR-0088 raised it, for the suites that test what still happens to one.
--
-- ADR-0141 d.5 (3 Oct) retired the request: `public.sub_task_extension_request` now refuses every call (hint
-- extension_retired). Requests raised before then are still pending on production and are still answered — forwarded,
-- approved, refused, withdrawn, escalated — and suites 101, 165, 176 and 177 test exactly that. They need a pending
-- request to answer, so this file keeps the retired function's body (its last definition, 20260926131000, verbatim)
-- under a test-only name. SECURITY DEFINER as the original was; `auth.uid()` still reads the caller's claims, so the
-- request is raised AS the person the suite has set — the record is what production holds. Never shipped: it lives
-- in this transaction and is rolled back with it.
CREATE OR REPLACE FUNCTION test_extension_request(p_sub_task uuid, p_to_day date, p_reason text, p_attributed_to text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_actor    uuid := auth.uid();
  v          sub_tasks%rowtype;
  v_to       timestamptz;
  v_pending  uuid;
  v_approver uuid;
  v_owner    uuid;
  v_step     boolean;
  v_to_whom  uuid;
  v_id       uuid := gen_random_uuid();
  v_w        text;   -- app.sla_event_writer, saved and restored (review, 11 Sep)
begin
  -- `for update`: pending is derived from the log (d.5), so two concurrent requests would both
  -- become pending without a lock on the task (review, 11 Sep). One lock, the same shape as
  -- maybe_complete_sub_task.
  select * into v from sub_tasks where id = p_sub_task and tenant_id = v_tenant for update;
  if not found then raise exception 'sub_task % not found', p_sub_task using errcode = 'P0002'; end if;

  if not app.sub_task_can_request_extension(p_sub_task) then
    raise exception 'only the task''s assignee, or somebody who could reschedule it, can ask for an extension'
      using errcode = '42501';
  end if;
  if v.status in ('done', 'cancelled') then
    raise exception 'this task is finished; there is no deadline left to extend' using errcode = '22023';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'say why the extension is needed — the approver decides on it' using errcode = '22023';
  end if;
  if p_attributed_to is null or p_attributed_to not in ('assignee', 'client', 'dependency') then
    raise exception 'say who the time is charged to: assignee, client or dependency' using errcode = '22023';
  end if;
  if p_to_day is null then
    raise exception 'a new deadline is required' using errcode = '22023';
  end if;

  v_to := app.close_of_day(p_to_day);
  if v.committed_due_at is not null and v_to <= v.committed_due_at then
    raise exception 'an extension moves the deadline later than the current commitment' using errcode = '22023';
  end if;
  -- ADR-0093: a date after the campaign's go-live is no longer refused here. The screen warns,
  -- the request is sent, and the account manager — who decides every extension (ADR-0088 d.4) —
  -- weighs it with the client's agreement in hand.

  -- d.5: one pending request per task — a new one supersedes the old, and both rows survive.
  select request_id into v_pending
    from public.sub_task_extension_requests r where r.sub_task_id = p_sub_task
   order by created_at desc limit 1;
  if v_pending is not null then
    v_w := coalesce(current_setting('app.sla_event_writer', true), '');
    perform set_config('app.sla_event_writer', 'on', true);
    insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
    values (v_tenant, v.deliverable_id, v.id, 'extension_withdrawn', v_actor,
            jsonb_build_object('request_id', v_pending, 'superseded_by', v_id));
    perform set_config('app.sla_event_writer', v_w, true);
  end if;

  v_approver := app.sub_task_extension_approver(p_sub_task);
  -- ADR-0109 d.1: the deliverable's owner judges first — unless the owner IS the approver, or there
  -- is no owner to ask, or (I59, settled 25 Sep) the owner is the one asking.
  select d.owner_user_id into v_owner from deliverables d where d.id = v.deliverable_id;
  v_step := v_owner is not null
            and v_owner is distinct from v_approver
            and v_owner is distinct from v_actor;
  v_to_whom := case when v_step then v_owner else v_approver end;

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (id, tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_id, v_tenant, v.deliverable_id, v.id, 'extension_requested', p_attributed_to::attribution_party,
          v_actor,
          jsonb_build_object('from', v.committed_due_at, 'to', v_to, 'reason', trim(p_reason),
                             'approver_user_id', v_approver,
                             'owner_user_id', v_owner, 'owner_step', v_step));
  perform set_config('app.sla_event_writer', v_w, true);

  -- d.9 / ADR-0109 d.1: the person whose step it is, and never the actor about their own act.
  if v_to_whom is not null and v_to_whom <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, v_to_whom, 'extension_requested', v.title, 'sub_task', v.id, v_actor,
            jsonb_build_object('stage', case when v_step then 'owner' else 'am' end,
                               'from', v.committed_due_at, 'to', v_to, 'reason', trim(p_reason)));
  end if;

  return v_id;
end $function$;
