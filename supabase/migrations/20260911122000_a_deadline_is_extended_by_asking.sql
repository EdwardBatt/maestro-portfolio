-- ADR-0088 / I46 — a deadline is extended by asking, and the account manager answers.
--
-- Edward, 11 Sep: "We need a formal means to extend deadlines on tasks.... this is subject to AM
-- approval." Until now a task's deadline moved in three ways, none of which was a request and none
-- of which asked anybody. ADR-0075 (20260911120000) keeps those moves free and keeps the COMMITMENT
-- beside them; this file adds the one act by which the commitment itself legitimately changes.
--
-- WHAT IS BUILT, decision by decision:
--
--   d.1  An extension changes `committed_due_at` and nothing else. The plan (starts_at, due_at, the
--        bookings) still moves by drag and dialog, exactly as before.
--   d.2  The assignee may ask, and so may anyone who could reschedule the task
--        (`project_tasks:manage` + `app.in_write_scope` over its placement and account manager).
--   d.3  The account manager answers, COMPUTED FROM SCOPE, no role named: `app.approve_campaign`'s
--        gate applied to the task's deliverable — `projects:manage` and
--        `app.in_write_scope(null, null, app.deliverable_account_manager(...))`. Where no account
--        manager resolves (ad-hoc, internal jobs) the request goes to whoever gave the work
--        (`assigned_by`) and is answered by the reschedule authority of d.2 — a bridge until ad-hoc
--        scheduling is retired. An approver who is also the requester does both in one press;
--        that is two RPC calls from one button, and the log shows the same person twice.
--   d.4  A request is a date (18:00 Asia/Baghdad on its day, ADR-0076), a MANDATORY reason (the
--        text of the ask — a message with nothing in it cannot be decided on) and one of three
--        attributions: assignee, client, dependency. Not `approver`: nobody asks for time because
--        the approver is slow; that is ADR-0045's chase, not this.
--   d.5  The record is `sla_events` and a request has no row of its own. Four event types:
--        extension_requested / extension_withdrawn / extension_approved / extension_refused. Pending
--        is DERIVED — no later decision names the request and the task is not done or cancelled —
--        and exposed as a security invoker view. One pending request per task: a new one supersedes
--        the old, recorded as a withdrawal and then the new request; nothing is edited.
--   d.6  Approval moves `committed_due_at` to the requested date. Nothing else: no booking moves, no
--        `rescheduled` fires. The stamp trigger's freeze is lifted for exactly that write by
--        `app.extension_decide`, the same shape as `app.system_op`.
--   d.7  The deliverable's due date does not move. A date after the campaign's go-live is refused
--        (a typing mistake, not a tight deadline). The fine/tight/at-risk arithmetic is shown by the
--        surfaces; the view carries the deliverable's deadline and the campaign's go-live for it.
--   d.7a The deliverable's due date moves ONLY through `public.deliverable_due_at_change`, which
--        REQUIRES an evidence asset filed in the campaign's own folders (the client's agreement —
--        a screenshot, an email — through the ordinary asset path into References, as the brief
--        receipt is, ADR-0066). A fence trigger refuses any other change of a LIVE deliverable's
--        `due_at` — live meaning under an approved campaign and not archived; a draft plan is still
--        being written and an ad-hoc job has no client behind its date. Recorded as
--        `deadline_changed` on the deliverable, attributed to the client, asset id in the payload.
--        A change that arrives any other way on a deliverable that is not live is still logged.
--   d.9  Three notification types. `extension_requested` to the resolved approver ONLY — not to the
--        failsafe roles, who can answer anything and would otherwise receive every request in the
--        agency (ADR-0070 d.6). `extension_approved` / `extension_refused` to the requester and the
--        assignee, de-duplicated, never the actor. The type list, the notify-email COPY map and the
--        EN/AR keys change in this same change set — `src/test/notification-copy.test.ts` holds it.
--   d.11 Built in 20260911121000.
--   d.12 Built on 20260911120000, which backfilled the commitment for every assigned task.
--
-- SECURITY DEFINER, with the reason (AGENTS.md §6): the RPCs write `sla_events` on the actor's
-- behalf (the insert policy demands actor = auth.uid(), which they set) and `notifications`, which
-- has no client insert policy at all — every emitter in the schema is definer for this reason. The
-- authority is decided inside each function by the two primitives ADR-0037 allows and nothing else.
-- search_path pinned on every function (ADR-0033).
--
-- Reproduced from their LAST definition (traps.md): `notifications_type_check` ← 20260911110000
-- (ADR-0087's four types ride along; the constraint is cumulative and 20260911130400 is final).
--
-- Tests: supabase/tests/101_a_deadline_is_extended_by_asking.sql

begin;

-- ============================================================================
-- 1) the four event types, and the index that makes "pending" a lookup
-- ============================================================================
alter table sla_events drop constraint sla_events_event_type_check;
alter table sla_events add constraint sla_events_event_type_check
  check (event_type in (
    'deadline_set', 'deadline_changed', 'scope_change',
    'clock_paused', 'clock_resumed',
    'blocked_flagged', 'block_cleared',
    'delivered', 'revision_requested', 'approved',
    -- ADR-0088 d.5
    'extension_requested', 'extension_withdrawn', 'extension_approved', 'extension_refused'
  ));

-- A decision names its request in the payload; this is what "no later decision names it" reads.
create index idx_sla_events_request_id
  on sla_events (((payload ->> 'request_id')::uuid))
  where event_type in ('extension_withdrawn', 'extension_approved', 'extension_refused');

-- ============================================================================
-- 2) a deadline lands at the close of its day (ADR-0076 d.3)
-- ============================================================================
-- The SQL twin of `endOfWorkingDay` in src/lib/time/iraq.ts. Iraq does not observe DST, but this is
-- a zone conversion and not "+ 15 hours" so that it stays right if that ever changes.
create or replace function app.close_of_day(p_day date) returns timestamptz
language sql immutable
set search_path = public, app, extensions as $$
  select (p_day + time '18:00') at time zone 'Asia/Baghdad'
$$;

-- ============================================================================
-- 3) who answers, and who may — computed, never named
-- ============================================================================
-- The person a request is SENT to (d.9): the campaign's account manager, or, where none resolves,
-- whoever gave the work. Null only for a task nobody assigned under a job with no manager.
create or replace function app.sub_task_extension_approver(p_sub_task uuid) returns uuid
language sql stable security definer
set search_path = public, app, extensions as $$
  select coalesce(app.deliverable_account_manager(st.deliverable_id), st.assigned_by)
    from public.sub_tasks st
   where st.id = p_sub_task
$$;

-- Whether the CALLER may answer (d.3). Where an account manager resolves, ADR-0088 d.3's gate —
-- `app.approve_campaign`'s, applied to the task's deliverable. Where none does, the reschedule
-- authority of d.2 over the task itself.
create or replace function app.sub_task_can_decide_extension(p_sub_task uuid) returns boolean
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks%rowtype;
  v_am uuid;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then return false; end if;
  v_am := app.deliverable_account_manager(v.deliverable_id);
  if v_am is not null then
    return app.has_permission('projects', 'manage')
       and app.in_write_scope(null, null, v_am);
  end if;
  return app.has_permission('project_tasks', 'manage')
     and app.in_write_scope(v.department_id, v.team_id, null);
end $$;

-- Whether the CALLER may ask (d.2): the assignee, or anyone who could reschedule the task.
create or replace function app.sub_task_can_request_extension(p_sub_task uuid) returns boolean
language plpgsql stable security definer
set search_path = public, app, extensions as $$
declare
  v sub_tasks%rowtype;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id();
  if not found then return false; end if;
  return v.assignee_id = auth.uid()
      or (app.has_permission('project_tasks', 'manage')
          and app.in_write_scope(v.department_id, v.team_id,
                                 app.deliverable_account_manager(v.deliverable_id)))
      or app.caller_is_project_pm(v.deliverable_id);
end $$;

comment on function app.sub_task_can_decide_extension(uuid) is
  'ADR-0088 d.3: whether the caller may answer an extension request on this task. The account '
  'manager by scope where one resolves; the reschedule authority where none does (ad-hoc bridge).';
comment on function app.sub_task_can_request_extension(uuid) is
  'ADR-0088 d.2: whether the caller may ask for an extension on this task — its assignee, or '
  'anyone who could reschedule it.';

-- ============================================================================
-- 4) the record, read: every extension event, and the pending ones
-- ============================================================================
-- Security invoker: RLS on sla_events / sub_tasks / deliverables / user_profiles decides what a
-- reader sees, exactly as it does for the tables themselves. `viewer_can_decide` and
-- `viewer_can_request` are the ONLY authorization the surfaces read (ADR-0037): a button is shown
-- from them, and the RPC decides again.
create or replace view public.sub_task_extension_events
with (security_invoker = true) as
-- Every column carries an explicit alias, including the ones that would not need one: the
-- frontend's select-string guard (src/test/postgrest-selects.test.ts) learns a view's columns from
-- its `as` aliases until `gen types` runs, and a column without one reads as a typo.
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
       case when e.event_type = 'extension_requested'
            then e.id
            else (e.payload ->> 'request_id')::uuid end as request_id,
       -- d.5: pending while no later decision names it and the task is not done or cancelled
       (e.event_type = 'extension_requested'
        and st.status not in ('done', 'cancelled')
        and not exists (
          select 1 from sla_events x
           where x.sub_task_id = e.sub_task_id
             and x.event_type in ('extension_withdrawn', 'extension_approved', 'extension_refused')
             and (x.payload ->> 'request_id')::uuid = e.id))
                                              as is_pending,
       st.title                               as task_title,
       st.status                              as task_status,
       st.assignee_id                         as assignee_id,
       ua2.display_name                       as assignee_name,
       st.due_at                              as plan_due_at,
       st.committed_due_at                    as committed_due_at,
       st.department_id                       as department_id,
       d.name                                 as deliverable_name,
       d.due_at                               as deliverable_due_at,
       s.campaign_id,
       c.name                                 as campaign_name,
       c.go_live_at,
       app.sub_task_extension_approver(st.id) as approver_id,
       ap.display_name                        as approver_name,
       app.sub_task_can_decide_extension(st.id)  as viewer_can_decide,
       app.sub_task_can_request_extension(st.id) as viewer_can_request
  from sla_events e
  join sub_tasks st         on st.id = e.sub_task_id
  join deliverables d       on d.id = st.deliverable_id
  left join streams s       on s.id = d.stream_id
  left join campaigns c     on c.id = s.campaign_id
  left join user_profiles ua  on ua.id = e.actor_user_id
  left join user_profiles ua2 on ua2.id = st.assignee_id
  left join user_profiles ap  on ap.id = app.sub_task_extension_approver(st.id)
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
       viewer_can_decide as viewer_can_decide, viewer_can_request as viewer_can_request
  from public.sub_task_extension_events
 where event_type = 'extension_requested' and is_pending;

comment on view public.sub_task_extension_events is
  'ADR-0088 d.5: every extension event on every task, with the task, deliverable and campaign it '
  'belongs to and the two viewer flags the surfaces read. Security invoker.';
comment on view public.sub_task_extension_requests is
  'ADR-0088 d.5: the PENDING requests — derived from the log, never a status anybody updates.';

grant select on public.sub_task_extension_events, public.sub_task_extension_requests to authenticated;

-- ============================================================================
-- 5) asking (d.2, d.4, d.5, d.7, d.9)
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
  v_go_live  timestamptz;
  v_pending  uuid;
  v_approver uuid;
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
  -- d.7: only a date after the campaign's go-live is refused.
  select c.go_live_at into v_go_live
    from deliverables d join streams s on s.id = d.stream_id join campaigns c on c.id = s.campaign_id
   where d.id = v.deliverable_id;
  if v_go_live is not null and v_to > v_go_live then
    raise exception 'that date is after the campaign goes live' using errcode = '22023';
  end if;

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

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (id, tenant_id, deliverable_id, sub_task_id, event_type, attributed_to,
                          actor_user_id, payload)
  values (v_id, v_tenant, v.deliverable_id, v.id, 'extension_requested', p_attributed_to::attribution_party,
          v_actor,
          jsonb_build_object('from', v.committed_due_at, 'to', v_to, 'reason', trim(p_reason),
                             'approver_user_id', v_approver));
  perform set_config('app.sla_event_writer', v_w, true);

  -- d.9: the resolved approver only, and never the actor about their own act.
  if v_approver is not null and v_approver <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v_tenant, v_approver, 'extension_requested', v.title, 'sub_task', v.id, v_actor);
  end if;

  return v_id;
end $$;

comment on function public.sub_task_extension_request(uuid, date, text, text) is
  'ADR-0088 d.2/d.4/d.5: ask for a task''s committed deadline to move to 18:00 Iraq on p_to_day, '
  'with a mandatory reason and an attribution (assignee | client | dependency). Supersedes a pending '
  'request. Notifies the resolved approver. Returns the request id (its sla_events row).';

revoke execute on function public.sub_task_extension_request(uuid, date, text, text) from public, anon;
grant  execute on function public.sub_task_extension_request(uuid, date, text, text) to authenticated;

-- ============================================================================
-- 6) withdrawing (d.5) — the requester, or anyone who could have asked
-- ============================================================================
create or replace function public.sub_task_extension_withdraw(p_request uuid) returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        record;
  v_id     uuid;
  v_w      text;
begin
  perform 1 from sub_tasks st
    where st.id = (select e.sub_task_id from sla_events e where e.id = p_request and e.tenant_id = v_tenant)
    for update;   -- serialise decide/withdraw on the task (review, 11 Sep)
  select * into r from public.sub_task_extension_requests q
   where q.request_id = p_request and q.tenant_id = v_tenant;
  if not found then
    raise exception 'that request is not pending' using errcode = 'P0002';
  end if;
  if r.actor_id <> v_actor and not app.sub_task_can_request_extension(r.sub_task_id) then
    raise exception 'only the requester can withdraw this' using errcode = '42501';
  end if;
  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, sub_task_id, event_type, actor_user_id, payload)
  values (v_tenant, r.deliverable_id, r.sub_task_id, 'extension_withdrawn', v_actor,
          jsonb_build_object('request_id', p_request, 'from', r.from_at, 'to', r.to_at))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);
  return v_id;
end $$;

revoke execute on function public.sub_task_extension_withdraw(uuid) from public, anon;
grant  execute on function public.sub_task_extension_withdraw(uuid) to authenticated;

-- ============================================================================
-- 7) answering (d.3, d.6, d.9)
-- ============================================================================
create or replace function public.sub_task_extension_decide(
  p_request uuid,
  p_approve boolean,
  p_note    text default null
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
  if p_approve is null then
    raise exception 'approve or refuse' using errcode = '22023';
  end if;

  if p_approve then
    -- d.6: the commitment moves, and nothing else. The stamp trigger's freeze is lifted for this
    -- one write, restored afterwards whatever it was (the save/restore shape of 20260829090000).
    v_prior := coalesce(current_setting('app.extension_decide', true), '');
    perform set_config('app.extension_decide', 'on', true);
    update sub_tasks set committed_due_at = r.to_at where id = r.sub_task_id;
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
                             'note', nullif(trim(coalesce(p_note, '')), '')))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);

  -- d.9: the requester and the assignee, de-duplicated, never the actor.
  for v_who in
    select distinct u from unnest(array[r.actor_id, r.assignee_id]) as u
     where u is not null and u <> v_actor
  loop
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (v_tenant, v_who,
            case when p_approve then 'extension_approved' else 'extension_refused' end,
            r.task_title, 'sub_task', r.sub_task_id, v_actor);
  end loop;

  return v_id;
end $$;

comment on function public.sub_task_extension_decide(uuid, boolean, text) is
  'ADR-0088 d.3/d.6/d.9: answer a pending extension request. Approval moves committed_due_at to '
  'the requested date and nothing else — the plan and the bookings are untouched. Refusal moves '
  'nothing. Both are logged and told to the requester and the assignee.';

revoke execute on function public.sub_task_extension_decide(uuid, boolean, text) from public, anon;
grant  execute on function public.sub_task_extension_decide(uuid, boolean, text) to authenticated;

-- ============================================================================
-- 8) d.7a — the promise moves only on the client's agreement, evidenced
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
  v_go_live  timestamptz;
  v_to       timestamptz;
  v_prior    text;
  v_id       uuid;
  v_w        text;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = v_tenant;
  if not found then raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002'; end if;

  select s.campaign_id, c.go_live_at into v_campaign, v_go_live
    from streams s join campaigns c on c.id = s.campaign_id
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

  -- No attachment, no change. The evidence is an asset filed in THIS campaign's folders.
  if p_evidence_asset is null or not exists (
       select 1 from assets a join asset_folders f on f.id = a.folder_id
        where a.id = p_evidence_asset and a.tenant_id = v_tenant and f.campaign_id = v_campaign) then
    raise exception 'attach the client''s agreement first — a date changes on evidence, as it was set on evidence'
      using errcode = '22023';
  end if;

  if p_due_day is null then
    raise exception 'a new date is required' using errcode = '22023';
  end if;
  v_to := app.close_of_day(p_due_day);
  if v_to is not distinct from d.due_at then
    raise exception 'that is already the promised date' using errcode = '22023';
  end if;
  if v_go_live is not null and v_to > v_go_live then
    raise exception 'that date is after the campaign goes live' using errcode = '22023';
  end if;

  v_prior := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  perform set_config('app.deliverable_due_at_change', 'on', true);
  update deliverables set due_at = v_to where id = p_deliverable;
  perform set_config('app.deliverable_due_at_change', v_prior, true);

  v_w := coalesce(current_setting('app.sla_event_writer', true), '');
  perform set_config('app.sla_event_writer', 'on', true);
  insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
  values (v_tenant, p_deliverable, 'deadline_changed', 'client', v_actor,
          jsonb_build_object('from', d.due_at, 'to', v_to, 'evidence_asset_id', p_evidence_asset,
                             'note', nullif(trim(coalesce(p_note, '')), '')))
  returning id into v_id;
  perform set_config('app.sla_event_writer', v_w, true);
  return v_id;
end $$;

comment on function public.deliverable_due_at_change(uuid, date, uuid, text) is
  'ADR-0088 d.7a: the ONE route by which a live deliverable''s promised date changes. The account '
  'manager by scope, with an evidence asset filed in the campaign''s folders, to 18:00 Iraq on the '
  'day, never after go-live. Logged as deadline_changed attributed to the client.';

revoke execute on function public.deliverable_due_at_change(uuid, date, uuid, text) from public, anon;
grant  execute on function public.deliverable_due_at_change(uuid, date, uuid, text) to authenticated;

-- The fence: any other change of a LIVE deliverable's due_at is refused. Live = under an approved
-- campaign and not archived. Setting a date that was blank is not changing a promise, and a draft
-- campaign's dates are still being written in the wizard — both pass.
create or replace function app.tg_deliverable_due_at_fence() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.due_at is not distinct from old.due_at then return new; end if;
  if auth.uid() is null or app.is_system_op()
     or coalesce(current_setting('app.deliverable_due_at_change', true), '') = 'on' then
    return new;
  end if;
  if old.due_at is null or old.state = 'archived' then return new; end if;
  if exists (select 1 from streams s join campaigns c on c.id = s.campaign_id
              where s.id = old.stream_id and c.status = 'approved') then
    raise exception
      'the promised date of a live deliverable changes only with the client''s agreement on record'
      using errcode = '42501';
  end if;
  return new;
end $$;

create trigger deliverable_due_at_fence
  before update of due_at on deliverables
  for each row execute function app.tg_deliverable_due_at_fence();

-- And the record, for the changes that do not come through the RPC (a draft being planned, a job
-- deliverable): ADR-0075 d.2 — a change of the promise is logged like any other. The RPC writes its
-- own richer row, so it is skipped here.
create or replace function app.tg_deliverable_deadline_log() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.due_at is not distinct from old.due_at then return null; end if;
  if coalesce(current_setting('app.deliverable_due_at_change', true), '') = 'on' then return null; end if;
  if old.due_at is null then return null; end if;   -- first date on a plan: not a change of promise
  insert into sla_events (tenant_id, deliverable_id, event_type, actor_user_id, payload)
  values (new.tenant_id, new.id, 'deadline_changed', auth.uid(),
          jsonb_build_object('from', old.due_at, 'to', new.due_at));
  return null;
end $$;

create trigger deliverable_deadline_log
  after update of due_at on deliverables
  for each row execute function app.tg_deliverable_deadline_log();

-- ============================================================================
-- 9) the three notification types (d.9) — reproduced from 20260903130100, plus three
-- ============================================================================
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'blocked', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'brief_awaiting_approval', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused',
    'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused'
  ));

comment on constraint notifications_type_check on notifications is
  'The list of notification types. Every value here needs `notify-email` COPY in both languages and '
  '`notifications.type.*` in src/locales/{en,ar}.json — src/test/notification-copy.test.ts fails '
  'the build when either is missing. Missed seven times before the test existed; do not make it '
  'eight. ADR-0088 d.9 added the three extension types.';

commit;
