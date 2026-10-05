-- ADR-0109 (Edward, 25 Sep; I59.22) — the deliverable's owner judges an extension request first, and
-- the account manager may give less time than was asked.
--
--   d.1  A request goes first to the deliverable's OWNER (`deliverables.owner_user_id`), who forwards
--        it with a note (`forward_extension`) or declines it with a reason (`owner_decline_extension`),
--        which ends it and tells the maker. When the owner IS the approver ADR-0088 d.3 resolves (the
--        account manager, or — for an ad-hoc task with no account manager — whoever gave the work),
--        the owner step is skipped. A deliverable with NO owner also skips it: there is nobody to
--        consult, and the request goes to the approver exactly as before (smallest safe choice,
--        listed as a question).
--   d.2  Only a forwarded (or skipped) request can be answered by the ADR-0088 d.3 authority. The
--        gate is held in the view (`viewer_can_decide`) AND in `sub_task_extension_decide`.
--   d.3  The account manager's approval may carry a SHORTER date: strictly after the current
--        commitment and strictly before the date asked, landing at 18:00 Asia/Baghdad on its day
--        (`app.close_of_day`, ADR-0076 d.3 — the same handling as the request itself). The maker and
--        the owner are told the date given.
--   d.4  Escalation is ADR-0108's sweep (another track); nothing here.
--
-- THE RECORD (ADR-0088 d.5 pattern — the log IS the state, nothing is updated):
--   * `extension_requested` now carries `owner_user_id` (the owner at the time) and `owner_step`
--     (whether the owner must judge first). Requests raised before this migration carry neither and
--     read as already at the account manager's step — they were sent there.
--   * `extension_forwarded` (new) names the request; it does NOT end it.
--   * the owner's decline is `extension_refused` with payload `stage = 'owner'`; it ends the request
--     exactly as the account manager's refusal does, so "pending" is unchanged.
--   * the account manager's shorter approval is `extension_approved` with `given` (the new
--     commitment) beside `to` (what was asked) and `shorter = true`.
--
-- NOTIFICATIONS: the owner on request (`extension_requested`, now to the owner when the step applies),
-- the account manager on forward (`extension_forwarded`), the maker on the owner's decline
-- (`extension_refused`, detail.stage = 'owner'), the requester and the assignee on the account
-- manager's answer (existing types, detail carries the dates); on a SHORTER approval the owner too
-- (ADR-0109 d.3). Never the actor about their own act. The fourteen new types are declared once in
-- 20260926090000; this file does not touch `notifications_type_check`.
--
-- Reproduced WHOLE from their latest definitions (grep confirmed each is the last):
--   sla_events_event_type_check             (20260913170000) — plus 'extension_forwarded';
--   app.tg_sla_event_deadline_record_fence  (20260911130600) — the new type is fenced too;
--   public.sub_task_extension_events / _requests (20260911122000) — columns appended, never reordered;
--   public.sub_task_extension_request       (20260914130000) — the owner step;
--   public.sub_task_extension_decide        (20260911122000) — the step gate and the shorter date.
--     Its signature gains `p_to_day date default null`, so the 3-argument function is DROPPED and
--     the 4-argument one created; every caller (the frontend's named-argument RPC, pgTAP 101) passes
--     three named arguments and resolves to it unchanged.
--
-- SECURITY DEFINER, with the reason (AGENTS.md §6): the RPCs write `sla_events` (fenced — only the
-- ADR-0088 RPCs, under `app.sla_event_writer`) and `notifications` (no client insert policy). Each
-- authorises inside itself with the owner check or ADR-0088's own primitives. search_path pinned.
--
-- Tests: supabase/tests/165_the_owner_judges_an_extension_first.sql

begin;

-- ============================================================================
-- 1) the event type, fenced like its siblings
-- ============================================================================
alter table sla_events drop constraint sla_events_event_type_check;
alter table sla_events add constraint sla_events_event_type_check
  check (event_type in (
    'deadline_set', 'deadline_changed', 'scope_change',
    'clock_paused', 'clock_resumed',
    'blocked_flagged', 'block_cleared',
    'delivered', 'revision_requested', 'approved',
    -- ADR-0088 d.5
    'extension_requested', 'extension_withdrawn', 'extension_approved', 'extension_refused',
    -- ADR-0075 d.9 / I41.8
    'due_date_override',
    -- ADR-0109 d.1
    'extension_forwarded'
  ));

create index if not exists idx_sla_events_forwarded_request
  on sla_events (((payload ->> 'request_id')::uuid))
  where event_type = 'extension_forwarded';

create or replace function app.tg_sla_event_deadline_record_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.event_type not in ('deadline_set', 'deadline_changed',
                            'extension_requested', 'extension_withdrawn',
                            'extension_approved', 'extension_refused',
                            -- ADR-0109: the owner's forward is part of the same record
                            'extension_forwarded') then
    return new;
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;                          -- migrations, seeders, system paths
  end if;
  if pg_trigger_depth() > 1 then
    return new;                          -- raised by a trigger on the task or the deliverable
  end if;
  if coalesce(current_setting('app.sla_event_writer', true), '') = 'on' then
    return new;                          -- the ADR-0088 / ADR-0109 RPCs
  end if;
  raise exception
    'the deadline record is written by the system — ask for an extension rather than writing one'
    using errcode = '42501';
end $$;

comment on function app.tg_sla_event_deadline_record_fence() is
  'ADR-0075 d.3 + ADR-0088 d.5 + ADR-0109, held by Postgres: deadline_set, deadline_changed and the '
  'five extension_* events are accepted only from a trigger, from the RPCs (app.sla_event_writer) '
  'or from a system op.';

-- ============================================================================
-- 2) the record, read — the owner's step appended to both views
-- ============================================================================
-- Every column keeps its position; the seven new ones are appended (create or replace view may
-- only add at the end). `viewer_can_decide` on a request row is now ALSO "the request is at the
-- account manager's step" (d.2) — which is what keeps `my_pending_approvals` (not modified here)
-- from listing a request its owner has not yet judged.
create or replace view public.sub_task_extension_events
with (security_invoker = true) as
select e.id                                   as event_id,
       e.event_type                           as event_type,
       e.tenant_id                            as tenant_id,
       e.sub_task_id                          as sub_task_id,
       e.deliverable_id                       as deliverable_id,
       e.actor_user_id                        as actor_id,
       ua.display_name                        as actor_name,
       e.created_at                           as created_at,
       (e.payload ->> 'from')::timestamptz    as from_at,
       (e.payload ->> 'to')::timestamptz      as to_at,
       e.payload ->> 'reason'                 as reason,
       e.payload ->> 'note'                   as note,
       e.attributed_to                        as attributed_to,
       rid.request_id                         as request_id,
       p.is_pending                           as is_pending,
       st.title                               as task_title,
       st.status                              as task_status,
       st.assignee_id                         as assignee_id,
       ua2.display_name                       as assignee_name,
       st.due_at                              as plan_due_at,
       st.committed_due_at                    as committed_due_at,
       st.department_id                       as department_id,
       d.name                                 as deliverable_name,
       d.due_at                               as deliverable_due_at,
       s.campaign_id                          as campaign_id,
       c.name                                 as campaign_name,
       c.go_live_at                           as go_live_at,
       app.sub_task_extension_approver(st.id) as approver_id,
       ap.display_name                        as approver_name,
       (app.sub_task_can_decide_extension(st.id)
        and (e.event_type <> 'extension_requested'
             or not coalesce((rq.payload ->> 'owner_step')::boolean, false)
             or fw.forwarded_at is not null))  as viewer_can_decide,
       app.sub_task_can_request_extension(st.id) as viewer_can_request,
       -- ADR-0109, appended ------------------------------------------------------------------
       coalesce((rq.payload ->> 'owner_step')::boolean, false) as owner_step,
       d.owner_user_id                        as owner_id,
       uo.display_name                        as owner_name,
       fw.forwarded_at                        as forwarded_at,
       fw.note                                as owner_note,
       case when e.event_type = 'extension_requested' and p.is_pending
            then case when coalesce((rq.payload ->> 'owner_step')::boolean, false)
                           and fw.forwarded_at is null
                      then 'owner' else 'am' end
       end                                    as stage,
       (e.event_type = 'extension_requested' and p.is_pending
        and coalesce((rq.payload ->> 'owner_step')::boolean, false)
        and fw.forwarded_at is null
        and d.owner_user_id = auth.uid())     as viewer_can_forward
  from sla_events e
  join sub_tasks st         on st.id = e.sub_task_id
  join deliverables d       on d.id = st.deliverable_id
  left join streams s       on s.id = d.stream_id
  left join campaigns c     on c.id = s.campaign_id
  left join user_profiles ua  on ua.id = e.actor_user_id
  left join user_profiles ua2 on ua2.id = st.assignee_id
  left join user_profiles ap  on ap.id = app.sub_task_extension_approver(st.id)
  left join user_profiles uo  on uo.id = d.owner_user_id
  cross join lateral (
    select case when e.event_type = 'extension_requested'
                then e.id else (e.payload ->> 'request_id')::uuid end as request_id
  ) rid
  left join sla_events rq on rq.id = rid.request_id and rq.event_type = 'extension_requested'
  cross join lateral (
    -- ADR-0088 d.5, unchanged: pending while no later decision names it and the task is open.
    select (e.event_type = 'extension_requested'
            and st.status not in ('done', 'cancelled')
            and not exists (
              select 1 from sla_events x
               where x.sub_task_id = e.sub_task_id
                 and x.event_type in ('extension_withdrawn', 'extension_approved', 'extension_refused')
                 and (x.payload ->> 'request_id')::uuid = e.id)) as is_pending
  ) p
  left join lateral (
    select f.created_at as forwarded_at, f.payload ->> 'note' as note
      from sla_events f
     where f.event_type = 'extension_forwarded'
       and f.sub_task_id = e.sub_task_id
       and (f.payload ->> 'request_id')::uuid = rid.request_id
     order by f.created_at desc
     limit 1
  ) fw on true
 where e.event_type in ('extension_requested', 'extension_withdrawn',
                        'extension_approved', 'extension_refused');

create or replace view public.sub_task_extension_requests
with (security_invoker = true) as
select event_id as event_id, event_type as event_type, tenant_id as tenant_id,
       sub_task_id as sub_task_id, deliverable_id as deliverable_id, actor_id as actor_id,
       actor_name as actor_name, created_at as created_at, from_at as from_at, to_at as to_at,
       reason as reason, note as note, attributed_to as attributed_to, request_id as request_id,
       is_pending as is_pending, task_title as task_title, task_status as task_status,
       assignee_id as assignee_id, assignee_name as assignee_name, plan_due_at as plan_due_at,
       committed_due_at as committed_due_at, department_id as department_id,
       deliverable_name as deliverable_name, deliverable_due_at as deliverable_due_at,
       campaign_id as campaign_id, campaign_name as campaign_name, go_live_at as go_live_at,
       approver_id as approver_id, approver_name as approver_name,
       viewer_can_decide as viewer_can_decide, viewer_can_request as viewer_can_request,
       -- ADR-0109, appended
       owner_step as owner_step, owner_id as owner_id, owner_name as owner_name,
       forwarded_at as forwarded_at, owner_note as owner_note, stage as stage,
       viewer_can_forward as viewer_can_forward
  from public.sub_task_extension_events
 where event_type = 'extension_requested' and is_pending;

comment on view public.sub_task_extension_events is
  'ADR-0088 d.5 + ADR-0109: every extension event (the forward is read into its request row, not '
  'listed as a row of its own), with the owner''s step — owner_step, forwarded_at, owner_note, stage '
  '(owner | am, pending requests only) — and the viewer flags. viewer_can_decide is false until the '
  'request reaches the account manager''s step. Security invoker.';
comment on view public.sub_task_extension_requests is
  'ADR-0088 d.5: the PENDING requests — derived from the log, never a status anybody updates. '
  'ADR-0109: stage says whose step it is.';

grant select on public.sub_task_extension_events, public.sub_task_extension_requests to authenticated;

-- ============================================================================
-- 3) asking — the owner first (d.1)
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
  -- is no owner to ask.
  select d.owner_user_id into v_owner from deliverables d where d.id = v.deliverable_id;
  v_step := v_owner is not null and v_owner is distinct from v_approver;
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
  'request. ADR-0109 d.1: sent first to the deliverable''s owner, unless the owner is the approver or '
  'there is no owner. Returns the request id (its sla_events row).';

revoke execute on function public.sub_task_extension_request(uuid, date, text, text) from public, anon;
grant  execute on function public.sub_task_extension_request(uuid, date, text, text) to authenticated;

-- ============================================================================
-- 4) the owner's step (d.1)
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

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_tenant, r.deliverable_id, r.sub_task_id, 'extension_forwarded', r.attributed_to, v_actor,
          jsonb_build_object('request_id', p_request, 'from', r.from_at, 'to', r.to_at,
                             'note', nullif(trim(coalesce(p_note, '')), '')))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);

  if r.approver_id is not null and r.approver_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, r.approver_id, 'extension_forwarded', r.task_title, 'sub_task', r.sub_task_id, v_actor,
            jsonb_build_object('from', r.from_at, 'to', r.to_at, 'reason', r.reason,
                               'note', nullif(trim(coalesce(p_note, '')), '')));
  end if;
  return v_id;
end $$;

comment on function public.forward_extension(uuid, text) is
  'ADR-0109 d.1/d.2: the deliverable''s owner forwards a pending extension request to the account '
  'manager, with an optional note. Logged as extension_forwarded; the request stays pending.';

revoke execute on function public.forward_extension(uuid, text) from public, anon;
grant  execute on function public.forward_extension(uuid, text) to authenticated;

create or replace function public.owner_decline_extension(p_request uuid, p_reason text)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        record;
  v_owner  uuid;
  v_id     uuid;
  v_who    uuid;
  v_w      text;
begin
  perform 1 from sub_tasks st
    where st.id = (select e.sub_task_id from sla_events e where e.id = p_request and e.tenant_id = v_tenant)
    for update;
  select * into r from public.sub_task_extension_requests q
   where q.request_id = p_request and q.tenant_id = v_tenant;
  if not found then
    raise exception 'that request is not pending' using errcode = 'P0002';
  end if;
  select d.owner_user_id into v_owner from deliverables d where d.id = r.deliverable_id;
  if v_owner is distinct from v_actor then
    raise exception 'Only the deliverable''s owner can decline this request here.%', app.refusal_ask(r.owner_name)
      using errcode = '42501', detail = coalesce(r.owner_name, ''), hint = 'owner_decline_extension';
  end if;
  if r.stage is distinct from 'owner' then
    raise exception 'this request is already with the account manager' using errcode = '55000';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'say why you are declining — the maker is told your reason' using errcode = '22023';
  end if;

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_tenant, r.deliverable_id, r.sub_task_id, 'extension_refused', r.attributed_to, v_actor,
          jsonb_build_object('request_id', p_request, 'from', r.from_at, 'to', r.to_at,
                             'reason', trim(p_reason), 'stage', 'owner'))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);

  -- The maker: the requester and the assignee, de-duplicated, never the actor.
  for v_who in
    select distinct u from unnest(array[r.actor_id, r.assignee_id]) as u
     where u is not null and u <> v_actor
  loop
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, v_who, 'extension_refused', r.task_title, 'sub_task', r.sub_task_id, v_actor,
            jsonb_build_object('stage', 'owner', 'reason', trim(p_reason),
                               'from', r.from_at, 'to', r.to_at));
  end loop;
  return v_id;
end $$;

comment on function public.owner_decline_extension(uuid, text) is
  'ADR-0109 d.1: the deliverable''s owner declines a pending extension request at their step, with a '
  'reason. Ends it (extension_refused, payload stage = owner); the maker is told.';

revoke execute on function public.owner_decline_extension(uuid, text) from public, anon;
grant  execute on function public.owner_decline_extension(uuid, text) to authenticated;

-- ============================================================================
-- 5) answering — only at the account manager's step, and perhaps with less time (d.2, d.3)
-- ============================================================================
drop function if exists public.sub_task_extension_decide(uuid, boolean, text);

create or replace function public.sub_task_extension_decide(
  p_request uuid,
  p_approve boolean,
  p_note    text default null,
  p_to_day  date default null
) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        record;
  v_prior  text;
  v_id     uuid;
  v_who    uuid;
  v_w      text;
  v_given  timestamptz;
  v_short  boolean := false;
  v_owner  uuid;
  v_detail jsonb;
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

  -- d.9: the requester and the assignee, de-duplicated, never the actor. ADR-0109 d.3: on a SHORTER
  -- approval, the owner too — they are told the date given.
  select d.owner_user_id into v_owner from deliverables d where d.id = r.deliverable_id;
  for v_who in
    select distinct u
      from unnest(array[r.actor_id, r.assignee_id,
                        case when v_short then v_owner end]) as u
     where u is not null and u <> v_actor
  loop
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, v_who,
            case when p_approve then 'extension_approved' else 'extension_refused' end,
            r.task_title, 'sub_task', r.sub_task_id, v_actor, v_detail);
  end loop;

  return v_id;
end $$;

comment on function public.sub_task_extension_decide(uuid, boolean, text, date) is
  'ADR-0088 d.3/d.6/d.9 + ADR-0109 d.2/d.3: answer a pending extension request at the account '
  'manager''s step (after the owner forwarded it, or when the owner step was skipped). Approval '
  'moves committed_due_at to the requested date — or to p_to_day (18:00 Iraq), strictly between the '
  'current commitment and the ask — and nothing else. Logged and told to the requester and the '
  'assignee, and on a shorter approval to the owner.';

revoke execute on function public.sub_task_extension_decide(uuid, boolean, text, date) from public, anon;
grant  execute on function public.sub_task_extension_decide(uuid, boolean, text, date) to authenticated;

-- ============================================================================
-- 6) Needs you — requests waiting on ME at MY step
-- ============================================================================
create or replace function public.needs_me_extensions()
returns table (
  request_id       uuid,
  stage            text,
  sub_task_id      uuid,
  deliverable_id   uuid,
  task_title       text,
  deliverable_name text,
  campaign_id      uuid,
  campaign_name    text,
  requested_by     uuid,
  requested_by_name text,
  assignee_id      uuid,
  from_at          timestamptz,
  to_at            timestamptz,
  reason           text,
  attributed_to    text,
  owner_note       text,
  requested_at     timestamptz,
  forwarded_at     timestamptz
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select x.request_id, x.stage, x.sub_task_id, x.deliverable_id, x.task_title, x.deliverable_name,
         x.campaign_id, x.campaign_name, x.actor_id, x.actor_name, x.assignee_id,
         x.from_at, x.to_at, x.reason, x.attributed_to::text, x.owner_note, x.created_at, x.forwarded_at
    from public.sub_task_extension_requests x
   where x.tenant_id = app.current_tenant_id()
     and (
       -- the owner's step: mine when I own the deliverable now (even a request I raised myself —
       -- the owner's judgement is still asked for, ADR-0109 d.1)
       (x.stage = 'owner' and x.viewer_can_forward)
       -- the account manager's step: as my_pending_approvals reads it (ADR-0088)
       or (x.stage = 'am' and x.approver_id = auth.uid() and x.viewer_can_decide
           and x.actor_id <> auth.uid())
     )
   order by x.created_at asc;
$$;

comment on function public.needs_me_extensions() is
  'ADR-0109: the pending extension requests waiting on the caller at the caller''s step — the owner''s '
  '(forward or decline) or the account manager''s (answer). Security invoker over the views.';

revoke execute on function public.needs_me_extensions() from public, anon;
grant  execute on function public.needs_me_extensions() to authenticated;

commit;
