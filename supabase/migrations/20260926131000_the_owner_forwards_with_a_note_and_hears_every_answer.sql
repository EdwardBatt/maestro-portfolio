-- I59.31 / E3, E4 and the coordinator's settled item (Edward, 25 Sep) — ADR-0109's owner step, as
-- answered.
--
--   E3  The owner's forwarding NOTE is REQUIRED (`forward_extension` refused without one).
--   E4  The owner is told of EVERY account-manager answer to a request they forwarded — approval,
--       shorter approval or refusal — with the existing types (extension_approved / extension_refused),
--       `detail.to_owner = true` on their row. Notification only. "They" = whoever forwarded it (the
--       actor of its extension_forwarded row); on a shorter approval the CURRENT owner is still told
--       as ADR-0109 d.3 had it, also marked to_owner.
--   settled  The owner step is SKIPPED when the owner is the one asking: the request goes straight to
--       the account manager's step, as when the owner is the approver.
--
-- Reproduced WHOLE from 20260926110000 (their only I59 definitions, grep confirmed 26 Sep):
--   public.sub_task_extension_request   — the skip;
--   public.forward_extension            — the note required;
--   public.sub_task_extension_decide    — the forwarder told.
-- Nothing else there changes; the views and needs_me_extensions are untouched (a request raised by
-- its owner now carries owner_step = false, so it never shows at the owner's step).
--
-- SECURITY DEFINER, as before (AGENTS.md §6): the RPCs write fenced `sla_events` and `notifications`.
--
-- Tests: supabase/tests/176_the_owner_forwards_with_a_note_and_hears_every_answer.sql

begin;

-- ============================================================================
-- asking — the owner first, unless the owner is the approver, is absent, or is asking
-- ============================================================================
create or replace function public.sub_task_extension_request(
  p_sub_task      uuid,
  p_to_day        date,
  p_reason        text,
  p_attributed_to text
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
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
end $$;

comment on function public.sub_task_extension_request(uuid, date, text, text) is
  'ADR-0088 d.2/d.4/d.5: ask for a task''s committed deadline to move to 18:00 Iraq on p_to_day, '
  'with a mandatory reason and an attribution (assignee | client | dependency). Supersedes a pending '
  'request. ADR-0109 d.1: sent first to the deliverable''s owner, unless the owner is the approver, '
  'there is no owner, or the owner is asking (I59 settled). Returns the request id (its sla_events row).';

revoke execute on function public.sub_task_extension_request(uuid, date, text, text) from public, anon;
grant  execute on function public.sub_task_extension_request(uuid, date, text, text) to authenticated;

-- ============================================================================
-- the owner's step — the note is required (E3)
-- ============================================================================
create or replace function public.forward_extension(p_request uuid, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        record;
  v_owner  uuid;
  v_id     uuid;
  v_w      text;
  v_note   text := nullif(trim(coalesce(p_note, '')), '');
begin
  perform 1 from sub_tasks st
    where st.id = (select e.sub_task_id from sla_events e where e.id = p_request and e.tenant_id = v_tenant)
    for update;   -- serialise with decide / withdraw on the task
  select * into r from public.sub_task_extension_requests q
   where q.request_id = p_request and q.tenant_id = v_tenant;
  if not found then
    raise exception 'that request is not pending' using errcode = 'P0002';
  end if;
  select d.owner_user_id into v_owner from deliverables d where d.id = r.deliverable_id;
  if v_owner is distinct from v_actor then
    raise exception 'Only the deliverable''s owner can forward this request.%', app.refusal_ask(r.owner_name)
      using errcode = '42501', detail = coalesce(r.owner_name, ''), hint = 'forward_extension';
  end if;
  if r.stage is distinct from 'owner' then
    raise exception 'this request is already with the account manager' using errcode = '55000';
  end if;
  -- E3 (25 Sep): the account manager decides on the owner's word — it is required.
  if v_note is null then
    raise exception 'Say what you think of this request — your note goes to the account manager with it.'
      using errcode = '22023', hint = 'forward_note_required';
  end if;

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_tenant, r.deliverable_id, r.sub_task_id, 'extension_forwarded', r.attributed_to, v_actor,
          jsonb_build_object('request_id', p_request, 'from', r.from_at, 'to', r.to_at, 'note', v_note))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);

  if r.approver_id is not null and r.approver_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, r.approver_id, 'extension_forwarded', r.task_title, 'sub_task', r.sub_task_id, v_actor,
            jsonb_build_object('from', r.from_at, 'to', r.to_at, 'reason', r.reason, 'note', v_note));
  end if;
  return v_id;
end $$;

comment on function public.forward_extension(uuid, text) is
  'ADR-0109 d.1/d.2: the deliverable''s owner forwards a pending extension request to the account '
  'manager with a REQUIRED note (I59 E3). Logged as extension_forwarded; the request stays pending.';

revoke execute on function public.forward_extension(uuid, text) from public, anon;
grant  execute on function public.forward_extension(uuid, text) to authenticated;

-- ============================================================================
-- the account manager answers — and the owner who forwarded it hears (E4)
-- ============================================================================
create or replace function public.sub_task_extension_decide(
  p_request uuid,
  p_approve boolean,
  p_note    text default null,
  p_to_day  date default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant    uuid := app.current_tenant_id();
  v_actor     uuid := auth.uid();
  r           record;
  v_prior     text;
  v_id        uuid;
  v_who       record;
  v_w         text;
  v_given     timestamptz;
  v_short     boolean := false;
  v_owner     uuid;
  v_forwarder uuid;
  v_detail    jsonb;
begin
  perform 1 from sub_tasks st
    where st.id = (select e.sub_task_id from sla_events e where e.id = p_request and e.tenant_id = v_tenant)
    for update;   -- serialise decide/withdraw on the task (review, 11 Sep)
  select * into r from public.sub_task_extension_requests q
   where q.request_id = p_request and q.tenant_id = v_tenant;
  if not found then
    raise exception 'that request is not pending' using errcode = 'P0002';
  end if;
  if not app.sub_task_can_decide_extension(r.sub_task_id) then
    raise exception 'you cannot answer this request — its account manager can'
      using errcode = '42501';
  end if;
  -- ADR-0109 d.2: the owner judges first.
  if r.stage is distinct from 'am' then
    raise exception 'The deliverable''s owner has not forwarded this request yet.%', app.refusal_ask(r.owner_name)
      using errcode = '55000', detail = coalesce(r.owner_name, ''), hint = 'extension_owner_step';
  end if;
  if p_approve is null then
    raise exception 'approve or refuse' using errcode = '22023';
  end if;

  v_given := r.to_at;
  if p_to_day is not null then
    -- d.3: a shorter extension — strictly after the current commitment, strictly before the ask.
    if not p_approve then
      raise exception 'a shorter date is given only with an approval' using errcode = '22023';
    end if;
    v_given := app.close_of_day(p_to_day);
    if r.committed_due_at is not null and v_given <= r.committed_due_at then
      raise exception 'a shorter extension still moves the deadline later than the current commitment'
        using errcode = '22023';
    end if;
    if v_given >= r.to_at then
      raise exception 'a shorter extension is earlier than the date asked for — approve the request as asked instead'
        using errcode = '22023';
    end if;
    v_short := true;
  end if;

  if p_approve then
    -- d.6: the commitment moves, and nothing else. The stamp trigger's freeze is lifted for this
    -- one write, restored afterwards whatever it was (the save/restore shape of 20260829090000).
    v_prior := coalesce(current_setting('app.extension_decide', true), '');
    perform set_config('app.extension_decide', 'on', true);
    update sub_tasks set committed_due_at = v_given where id = r.sub_task_id;
    perform set_config('app.extension_decide', v_prior, true);
  end if;

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_tenant, r.deliverable_id, r.sub_task_id,
          case when p_approve then 'extension_approved' else 'extension_refused' end,
          r.attributed_to, v_actor,
          jsonb_build_object('request_id', p_request, 'from', r.from_at, 'to', r.to_at,
                             'note', nullif(trim(coalesce(p_note, '')), ''))
          || case when p_approve then jsonb_build_object('given', v_given, 'shorter', v_short)
                  else jsonb_build_object('stage', 'am') end)
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);

  v_detail := jsonb_build_object('stage', 'am', 'from', r.from_at, 'requested_to', r.to_at,
                                 'note', nullif(trim(coalesce(p_note, '')), ''))
              || case when p_approve then jsonb_build_object('to', v_given, 'shorter', v_short)
                      else jsonb_build_object('to', r.to_at) end;

  -- E4: the owner who forwarded it (the actor of its extension_forwarded row).
  select f.actor_user_id into v_forwarder
    from sla_events f
   where f.event_type = 'extension_forwarded'
     and f.sub_task_id = r.sub_task_id
     and (f.payload ->> 'request_id')::uuid = p_request
   order by f.created_at desc
   limit 1;

  -- d.9: the requester and the assignee, de-duplicated, never the actor. ADR-0109 d.3: on a SHORTER
  -- approval, the current owner too. E4: the owner who forwarded it, on every answer. An owner's row
  -- carries detail.to_owner = true.
  select d.owner_user_id into v_owner from deliverables d where d.id = r.deliverable_id;
  for v_who in
    select x.u, bool_or(x.as_owner) as as_owner
      from (select unnest(array[r.actor_id, r.assignee_id,
                                case when v_short then v_owner end, v_forwarder]) as u,
                   unnest(array[false, false, true, true]) as as_owner) x
     where x.u is not null and x.u <> v_actor
     group by x.u
  loop
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, v_who.u,
            case when p_approve then 'extension_approved' else 'extension_refused' end,
            r.task_title, 'sub_task', r.sub_task_id, v_actor,
            v_detail || case when v_who.as_owner then jsonb_build_object('to_owner', true)
                             else '{}'::jsonb end);
  end loop;

  return v_id;
end $$;

comment on function public.sub_task_extension_decide(uuid, boolean, text, date) is
  'ADR-0088 d.3/d.6/d.9 + ADR-0109 d.2/d.3: answer a pending extension request at the account '
  'manager''s step (after the owner forwarded it, or when the owner step was skipped). Approval '
  'moves committed_due_at to the requested date — or to p_to_day (18:00 Iraq), strictly between the '
  'current commitment and the ask — and nothing else. Logged and told to the requester and the '
  'assignee; I59 E4: to the owner who forwarded it on every answer (and the current owner on a '
  'shorter approval), detail.to_owner = true.';

revoke execute on function public.sub_task_extension_decide(uuid, boolean, text, date) from public, anon;
grant  execute on function public.sub_task_extension_decide(uuid, boolean, text, date) to authenticated;

commit;
