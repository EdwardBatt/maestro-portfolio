-- ADR-0103 (Edward, 25 Sep) — finished work can be re-opened: a task, a deliverable, a campaign.
--
--   d.1  who     — project_tasks:manage AND reach over the campaign's account manager or the
--                  department of the deliverable's owner (ADR-0102): `app.may_reopen`.
--   d.2  a task  — done → todo, the same assignee and reviewers, approval cleared, a reason and a
--                  new due date required (the new commitment), the assignee and reviewers told.
--   d.3  a deliverable — by the tasks picked (at least one); the container goes to in_progress; the
--                  bare approved/delivered → in_progress move is fenced off everywhere else.
--   d.4  a campaign — a closed one re-opens on d.1's authority; a re-open inside a closed campaign
--                  re-opens it, and says so.
--
-- Reproduced WHOLE from their latest definitions (grep confirmed each is the last):
--   app.tg_sub_task_commitment_stamp  (20260920110000) — one added condition, `app.task_reopen`;
--   public.reopen_campaign            (20260913100000) — d.1's authority;
--   notifications_type_check          (20260922170000) — two values added, cumulatively.

begin;

-- ---------------------------------------------------------------- d.1: who ----
create or replace function app.may_reopen(p_deliverable uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select app.has_permission('project_tasks', 'manage')
     and exists (
       select 1 from public.deliverables d
        where d.id = p_deliverable
          and d.tenant_id = app.current_tenant_id()
          and app.in_write_scope(d.department_id, null, app.deliverable_account_manager(d.id)))
$$;

comment on function app.may_reopen(uuid) is
  'ADR-0103 d.1: project_tasks:manage and reach over the deliverable — its campaign''s account '
  'manager (account roles; tenant-wide roles reach everyone) or the department of its owner '
  '(ADR-0102; department leads, and team leads of a team in that department).';

revoke execute on function app.may_reopen(uuid) from public, anon;
grant  execute on function app.may_reopen(uuid) to authenticated;

-- The screen's mirror: which of these may I re-open? One call for a whole campaign page.
create or replace function public.reopenable_deliverables(p_campaign uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select d.id
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign
     and d.tenant_id = app.current_tenant_id()
     and app.may_reopen(d.id)
$$;

revoke execute on function public.reopenable_deliverables(uuid) from public, anon;
grant  execute on function public.reopenable_deliverables(uuid) to authenticated;

-- ---------------------------------------------------------------- the fence (d.3) ----
-- The guard (20260914160000) still allows approved/delivered → in_progress to anyone with
-- project_tasks:manage. That move alone leaves a container "in progress" with every task approved —
-- nothing to do and nothing to tell anybody. It is now made only by reopen_deliverable, which
-- re-opens at least one task in the same transaction.
create or replace function app.tg_deliverable_reopen_fence()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions
as $$
begin
  if old.state in ('approved', 'delivered') and new.state = 'in_progress'
     and auth.uid() is not null
     and not app.is_system_op()
     and coalesce(current_setting('app.reopen', true), '') <> 'on' then
    raise exception
      'a finished deliverable is re-opened by choosing which of its tasks need doing again'
      using errcode = '42501', hint = 'reopen_deliverable';
  end if;
  return new;
end $$;

drop trigger if exists deliverable_reopen_fence on deliverables;
create trigger deliverable_reopen_fence
  before update of state on deliverables
  for each row execute function app.tg_deliverable_reopen_fence();

-- ---------------------------------------------------------------- the commitment (d.2) ----
-- Reproduced from 20260920110000; the only change: a re-open stamps the new commitment, as an
-- approved extension does. The old one stays on the record (audit_events, sub_task_deadline_log).
CREATE OR REPLACE FUNCTION app.tg_sub_task_commitment_stamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v_free boolean := auth.uid() is null
                    or app.is_system_op()
                    or coalesce(current_setting('app.extension_decide', true), '') = 'on'
                    or coalesce(current_setting('app.task_reopen', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      new.committed_starts_at := new.starts_at;
      new.committed_due_at    := app.commitment_instant(new.due_at);
      new.committed_hours     := new.sla_hours;
    else
      new.committed_starts_at := null;
      new.committed_due_at    := null;
      new.committed_hours     := null;
    end if;
    return new;
  end if;

  if old.committed_due_at is null and old.committed_starts_at is null
     and new.assignee_id is not null
     and (new.due_at is not null or new.starts_at is not null) then
    new.committed_starts_at := new.starts_at;
    new.committed_due_at    := app.commitment_instant(new.due_at);
    new.committed_hours     := new.sla_hours;
  elsif not v_free
        and (new.committed_starts_at is distinct from old.committed_starts_at
             or new.committed_due_at is distinct from old.committed_due_at
             or new.committed_hours  is distinct from old.committed_hours) then
    raise exception
      'a task''s commitment is stamped when it is assigned and changes only by an approved extension'
      using errcode = '42501';
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------- notifications ----
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
    'task_reopened', 'deliverable_reopened'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. blocked and brief_awaiting_approval removed 17 Sep: nothing raised the first, and '
  'the second could only fire for a brief that existed before approval, which none does. '
  'assignment_overdue added 22 Sep (SJ-v3-04, ADR-0045): an opened job still unassigned after the '
  'tenant''s hours, to the traffic managers and the owner. task_reopened and deliverable_reopened '
  'added 25 Sep (ADR-0103): to a re-opened task''s assignee and reviewers, and to the owner of a '
  're-opened deliverable, with the reason in detail.';

-- ---------------------------------------------------------------- the inner step ----
-- Re-open ONE task, already authorised and inside an open container. Not granted to anyone: the
-- two public functions below are the doors.
create or replace function app.reopen_one_task(p_sub_task uuid, p_reason text, p_due_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v sub_tasks;
  v_actor uuid := auth.uid();
  r record;
begin
  select * into v from sub_tasks where id = p_sub_task and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'task % not found', p_sub_task using errcode = 'P0002';
  end if;
  if v.status = 'cancelled' then
    raise exception '"%" was called off, not finished — it cannot be re-opened', v.title using errcode = '22023';
  end if;
  if v.status <> 'done' then
    raise exception '"%" is not finished — only an approved task is re-opened', v.title using errcode = '22023';
  end if;

  perform set_config('app.task_reopen', 'on', true);
  update sub_tasks
     set status          = 'todo',
         approved_at     = null,
         approved_by     = null,
         due_at          = p_due_at,
         starts_at       = case when starts_at is not null and starts_at > p_due_at then null else starts_at end,
         committed_due_at = case when assignee_id is not null then app.commitment_instant(p_due_at) else committed_due_at end,
         revision_number = coalesce(revision_number, 0) + 1
   where id = p_sub_task;
  perform set_config('app.task_reopen', 'off', true);
  -- The reviewers' answers are cleared by app.tg_subtask_clear_approvals (status left done).

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, v_actor, 'task_reopened', 'sub_tasks', v.id,
          jsonb_build_object('reason', p_reason, 'due_at', p_due_at,
                             'was_approved_at', v.approved_at, 'was_approved_by', v.approved_by,
                             'was_due_at', v.due_at, 'deliverable_id', v.deliverable_id));

  -- d.2: the assignee and every reviewer are told — never the person who re-opened it.
  for r in
    select v.assignee_id as user_id, false as reviewer where v.assignee_id is not null
    union
    select rv.user_id, true from sub_task_reviewers rv where rv.sub_task_id = v.id
  loop
    if r.user_id is distinct from v_actor then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (v.tenant_id, r.user_id, 'task_reopened', v.title, 'sub_task', v.id, v_actor,
              jsonb_build_object('reason', p_reason, 'due_at', p_due_at, 'for_reviewer', r.reviewer));
    end if;
  end loop;
end $$;

revoke execute on function app.reopen_one_task(uuid, text, timestamptz) from public, anon, authenticated;

-- Open the campaign the work sits in, when it was closed (d.4). Returns whether it did.
create or replace function app.reopen_campaign_for(p_deliverable uuid)
returns boolean
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_campaign uuid;
begin
  select s.campaign_id into v_campaign
    from deliverables d join streams s on s.id = d.stream_id
   where d.id = p_deliverable;
  if v_campaign is null then
    return false;
  end if;
  update campaigns
     set status = 'approved', closed_at = null, closed_by = null
   where id = v_campaign and status = 'closed';
  if not found then
    return false;
  end if;
  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (app.current_tenant_id(), auth.uid(), 'campaign_reopened', 'campaigns', v_campaign,
          jsonb_build_object('because_deliverable', p_deliverable));
  return true;
end $$;

revoke execute on function app.reopen_campaign_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- d.3: a deliverable ----
-- Re-open a finished deliverable by the tasks picked. Also the door for ONE task (d.2): a task
-- re-opened on its own is a deliverable re-opened by that task, whatever state the container is in.
create or replace function public.reopen_deliverable(
  p_deliverable uuid, p_tasks uuid[], p_reason text, p_due_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  d deliverables;
  v_actor uuid := auth.uid();
  v_task uuid;
  v_titles text[];
  v_campaign_reopened boolean := false;
begin
  select * into d from deliverables where id = p_deliverable and tenant_id = app.current_tenant_id() for update;
  if not found then
    raise exception 'deliverable % not found', p_deliverable using errcode = 'P0002';
  end if;
  if not app.may_reopen(p_deliverable) then
    raise exception
      're-opening "%" is outside your reach — its account manager, Traffic, an Account Director, a Power Admin or a lead of its owner''s department can',
      d.name using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'say why it is being re-opened — the reason goes on the record and to the people told'
      using errcode = '22023';
  end if;
  if p_due_at is null then
    raise exception 'a re-opened task needs a new due date' using errcode = '22023';
  end if;
  if p_due_at < now() then
    raise exception 'the new due date is in the past' using errcode = '22023';
  end if;
  if p_tasks is null or cardinality(p_tasks) = 0 then
    raise exception 'choose at least one task to do again' using errcode = '22023';
  end if;
  if d.state = 'archived' then
    raise exception '"%" was called off — it cannot be re-opened', d.name using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_tasks) t(id)
              where not exists (select 1 from sub_tasks st where st.id = t.id and st.deliverable_id = p_deliverable)) then
    raise exception 'a task chosen is not one of "%"''s', d.name using errcode = '22023';
  end if;

  -- d.4 first: the work cannot move inside a closed campaign.
  v_campaign_reopened := app.reopen_campaign_for(p_deliverable);

  if d.state in ('approved', 'delivered') then
    perform set_config('app.reopen', 'on', true);
    update deliverables set state = 'in_progress' where id = p_deliverable;
    perform set_config('app.reopen', 'off', true);
  end if;

  foreach v_task in array p_tasks loop
    perform app.reopen_one_task(v_task, trim(p_reason), p_due_at);
  end loop;

  select array_agg(st.title order by st.sort_order, st.unit_index) into v_titles
    from sub_tasks st where st.id = any(p_tasks);

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_reopened', 'deliverables', d.id,
          jsonb_build_object('reason', trim(p_reason), 'tasks', p_tasks, 'due_at', p_due_at,
                             'was_state', d.state, 'campaign_reopened', v_campaign_reopened));

  -- The owner is told what came back and why — unless they did it, or already heard as a task's
  -- assignee or reviewer.
  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor
     and not exists (select 1 from sub_tasks st where st.id = any(p_tasks) and st.assignee_id = d.owner_user_id)
     and not exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = any(p_tasks) and rv.user_id = d.owner_user_id) then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_reopened', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('reason', trim(p_reason), 'due_at', p_due_at, 'tasks', to_jsonb(v_titles),
                               'campaign_reopened', v_campaign_reopened));
  end if;

  return jsonb_build_object('reopened', cardinality(p_tasks), 'campaign_reopened', v_campaign_reopened);
end $$;

comment on function public.reopen_deliverable(uuid, uuid[], text, timestamptz) is
  'ADR-0103 d.2–d.4: the picked tasks go back to To do (same people, approval cleared, new due date '
  'and commitment), the container to in_progress, a closed campaign re-opens; the assignee, reviewers '
  'and owner are told with the reason. The one door for re-opening a task.';

revoke execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz) from public, anon;
grant  execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz) to authenticated;

-- A single task — the row's own Re-open. The same door, one task.
create or replace function public.reopen_task(p_sub_task uuid, p_reason text, p_due_at timestamptz)
returns jsonb
language sql
security invoker
set search_path = public, app, extensions
as $$
  select public.reopen_deliverable(
    (select st.deliverable_id from sub_tasks st where st.id = p_sub_task), array[p_sub_task], p_reason, p_due_at)
$$;

revoke execute on function public.reopen_task(uuid, text, timestamptz) from public, anon;
grant  execute on function public.reopen_task(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------- d.4: a campaign ----
-- Reproduced from 20260913100000; the authority is d.1's: the account roles over its account
-- manager, or a lead of any department that owns a deliverable on it.
CREATE OR REPLACE FUNCTION public.reopen_campaign(p_campaign uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
declare
  v    campaigns;
  v_am uuid;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status <> 'closed' then
    return;                                        -- only a closed campaign reopens; idempotent
  end if;

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;
  if not (
       (app.has_permission('project_tasks', 'manage') and app.in_write_scope(null, null, v_am))
       or exists (select 1 from deliverables d join streams s on s.id = d.stream_id
                   where s.campaign_id = p_campaign and app.may_reopen(d.id))
     ) then
    raise exception
      're-opening this campaign is outside your reach — its account manager, Traffic, an Account Director, a Power Admin or a lead of a department with work on it can'
      using errcode = '42501';
  end if;

  update campaigns
     set status = 'approved', closed_at = null, closed_by = null
   where id = p_campaign;
  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, auth.uid(), 'campaign_reopened', 'campaigns', p_campaign, '{}'::jsonb);
end $function$;

comment on function public.reopen_campaign(uuid) is
  'ADR-0103 d.1/d.4: a closed campaign back to approved — by its account roles, or a lead of any '
  'department owning a deliverable on it. Its work is untouched; re-opening work is reopen_deliverable.';

commit;
