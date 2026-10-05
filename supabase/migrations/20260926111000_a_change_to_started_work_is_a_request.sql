-- ADR-0110 (Edward, 25 Sep; I59.23) — a change to started work is a request the owner answers.
--
--   d.1  On a deliverable whose work has STARTED — any task `in_progress`, `review` or `done`, or any
--        `task_time_entries` row on any of its tasks — its type, quantity, department or due date
--        does not save directly: it becomes a change request to the deliverable's owner, carrying
--        before and after, the cost, and who asked (the client — spends a revision round; us —
--        counts nothing). Name, priority and notes save as today; unstarted work saves as today.
--        HELD IN POSTGRES: `deliverable_started_change_guard` refuses the four fields on started work
--        unless the write is made by `app.apply_deliverable_change_request` (transaction flag
--        `app.change_request_apply`), so a PATCH, `update_campaign_deliverable` and the evidenced
--        `deliverable_due_at_change` are governed identically.
--   d.2  The owner accepts (the change applies), declines (a reason), or pushes back (words and an
--        optional date).
--   d.3  On a push-back the requester or the campaign's account-manager authority accepts her
--        version (the change applies, her date replacing the due date when she gave one) or
--        withdraws (nothing changes, no round spent). A declined request stays in the requester's
--        Needs you until Closed. There is no "insist".
--   d.4  Escalation is ADR-0108's sweep (another track); nothing here.
--
-- WHAT "THE EDIT" WRITES TODAY (read from `EditPieceDialog.tsx`, CG-E1):
--   * type, quantity — `update_campaign_deliverable` (UPDATE deliverables … deliverable_type_id,
--     quantity), governed by `tg_deliverable_edit_guard`;
--   * due — the evidenced `deliverable_due_at_change` (ADR-0088 d.7a), fenced by
--     `tg_deliverable_due_at_fence`;
--   * department — never chosen: it follows the owner (`tg_deliverable_stamp_department`, ADR-0102).
--     So the guard treats a department change that comes WITH an owner change as the owner change it
--     is (unaffected), and a request may carry a department only when the owner has none — otherwise
--     the stamp would put it straight back (refused at request time with the reason; a question).
--
-- A REVISION ROUND. The counter that exists is `deliverables.revision_round` against
-- `revision_limit` (ADR-0024, warn-and-allow). It is NOT incremented here: the transition guard pins
-- it on every write that does not change state ("never client-writable"), and it still stamps
-- `media_records.round` / `review_feedback.round` for deliverable-level versions (20260914150000,
-- 20260818110000), so bumping it would renumber review rounds. A client-asked change that applies
-- is recorded on the request (`round_spent = true`) and counted by `app.deliverable_rounds_spent`.
-- Which counter Edward means is a question.
--
-- SECURITY DEFINER, with the reason (AGENTS.md §6): the RPCs write `deliverable_change_requests`
-- (no client write policy — every transition is an RPC) and `notifications` (no client insert
-- policy), and the apply writes `deliverables` through fences that only it may pass. Each RPC
-- authorises inside itself: the deliverable-edit gate (mirroring `tg_deliverable_edit_guard`), the
-- current owner, or ADR-0088 d.3's account-manager authority — `app.has_permission` +
-- `app.in_write_scope`, nothing else (ADR-0037). search_path pinned on every function.
--
-- Tests: supabase/tests/166_a_change_to_started_work_is_a_request.sql,
--        supabase/tests/168_running_the_week_records_stay_in_their_tenant.sql

begin;

-- ============================================================================
-- 1) the record
-- ============================================================================
create table deliverable_change_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  deliverable_id  uuid not null references deliverables(id),
  requested_by    uuid not null references user_profiles(id),
  -- the owner at the time of asking; the CURRENT owner answers (an owner change moves the question)
  owner_user_id   uuid references user_profiles(id),
  -- {field: {from, to}} for type | quantity | department | due; `from` is the server's reading
  changes         jsonb not null
                  constraint chk_deliverable_change_requests_changes
                  check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  asked_by        text not null
                  constraint chk_deliverable_change_requests_asked_by check (asked_by in ('client', 'us')),
  cost            jsonb not null default '{}'::jsonb
                  constraint chk_deliverable_change_requests_cost check (jsonb_typeof(cost) = 'object'),
  status          text not null default 'pending'
                  constraint chk_deliverable_change_requests_status
                  check (status in ('pending', 'accepted', 'declined', 'pushed_back', 'counter_accepted', 'withdrawn')),
  decline_reason  text,
  counter_text    text,
  counter_date    date,
  -- a client-asked change that applied (ADR-0110 d.1) — see the header on the revision round
  round_spent     boolean not null default false,
  answered_by     uuid,
  answered_at     timestamptz,
  resolved_by     uuid,
  resolved_at     timestamptz,
  closed_at       timestamptz,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint chk_deliverable_change_requests_declined_has_reason
    check (status <> 'declined' or length(trim(coalesce(decline_reason, ''))) > 0),
  constraint chk_deliverable_change_requests_pushed_back_has_words
    check (status not in ('pushed_back', 'counter_accepted') or length(trim(coalesce(counter_text, ''))) > 0),
  constraint chk_deliverable_change_requests_closed_only_declined
    check (closed_at is null or status = 'declined')
);

create index idx_deliverable_change_requests_tenant_id on deliverable_change_requests (tenant_id);
create index idx_deliverable_change_requests_deliverable on deliverable_change_requests (deliverable_id);
create index idx_deliverable_change_requests_requested_by on deliverable_change_requests (requested_by);
-- One open question per deliverable: two requests racing to apply to the same fields cannot both be
-- right, and the owner answers one thing at a time (smallest safe choice; a question).
create unique index uq_deliverable_change_requests_open
  on deliverable_change_requests (deliverable_id)
  where status in ('pending', 'pushed_back');

comment on table deliverable_change_requests is
  'ADR-0110: a change to a STARTED deliverable''s type, quantity, department or due date, asked of '
  'its owner. Every transition is an RPC (request / answer / resolve / close); there is no client '
  'write policy. Read tenant-wide, like the other per-piece records.';

grant select on table public.deliverable_change_requests to authenticated;
-- Anonymous callers have no business here at all (Supabase's default privileges would grant them).
revoke all on table public.deliverable_change_requests from anon;

alter table deliverable_change_requests enable row level security;
alter table deliverable_change_requests force row level security;

-- Read: anyone in the tenant — the same rule as `campaign_brief_receipts_tenant_select` and
-- `task_time_entries_tenant_select`: a record about a piece is visible to the people on the piece.
create policy deliverable_change_requests_tenant_select on deliverable_change_requests
  for select to authenticated
  using (tenant_id = app.current_tenant_id());
-- No insert / update / delete policy: deny by default; the RPCs below are the only writers.

create trigger set_updated_at before update on deliverable_change_requests
  for each row execute function app.set_updated_at();

create trigger set_actor_columns
  before insert or update on deliverable_change_requests
  for each row execute function app.set_actor_columns();

create trigger audit_row_change
  after insert or update or delete on deliverable_change_requests
  for each row execute function app.audit_row_change();

-- ============================================================================
-- 2) "started", and who may edit today
-- ============================================================================
create or replace function app.deliverable_is_started(p_deliverable uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (
           select 1 from sub_tasks st
            where st.deliverable_id = p_deliverable
              and st.status in ('in_progress', 'review', 'done'))
      or exists (
           select 1 from task_time_entries te
             join sub_tasks st on st.id = te.sub_task_id
            where st.deliverable_id = p_deliverable)
$$;

comment on function app.deliverable_is_started(uuid) is
  'ADR-0110 d.1: a deliverable''s work has started when any of its tasks is in_progress, review or '
  'done, or any of its tasks has a time entry.';

-- The screen's mirror (Edit decides whether Save becomes a change request). Tenant-checked.
create or replace function public.deliverable_is_started(p_deliverable uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (select 1 from deliverables d
                  where d.id = p_deliverable and d.tenant_id = app.current_tenant_id())
     and app.deliverable_is_started(p_deliverable)
$$;

revoke execute on function public.deliverable_is_started(uuid) from public, anon;
grant  execute on function public.deliverable_is_started(uuid) to authenticated;

-- Whoever may edit the deliverable today: `tg_deliverable_edit_guard`'s own gate (20260917150000),
-- read here so asking has exactly the authority saving had.
create or replace function app.may_edit_deliverable(p_deliverable uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select exists (
    select 1 from deliverables d
     where d.id = p_deliverable
       and d.tenant_id = app.current_tenant_id()
       and (d.owner_user_id = auth.uid()
            or app.deliverable_account_manager(d.id) = auth.uid()
            or (app.has_permission('project_tasks', 'manage')
                and app.in_write_scope(d.department_id, null, app.deliverable_account_manager(d.id)))))
$$;

comment on function app.may_edit_deliverable(uuid) is
  'ADR-0110: the deliverable-edit authority of tg_deliverable_edit_guard — its owner, its account '
  'manager, or project_tasks:manage within reach of its department.';

-- The campaign's account-manager authority (ADR-0088 d.3's gate, applied to the deliverable).
create or replace function app.is_deliverable_am_authority(p_deliverable uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select app.deliverable_account_manager(p_deliverable) is not null
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, app.deliverable_account_manager(p_deliverable))
$$;

revoke execute on function app.deliverable_is_started(uuid), app.may_edit_deliverable(uuid),
                           app.is_deliverable_am_authority(uuid) from public, anon;
grant  execute on function app.deliverable_is_started(uuid), app.may_edit_deliverable(uuid),
                           app.is_deliverable_am_authority(uuid) to authenticated;

-- ============================================================================
-- 3) the guard (d.1)
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
  raise exception
    'Work on this deliverable has started, so its type, quantity, department or due date changes only by a change request to its owner.%',
    app.refusal_ask(app.refusal_names_deliverable_owner(old.id))
    using errcode = '55000',
          detail = coalesce(app.refusal_names_deliverable_owner(old.id), ''),
          hint = 'change_request_required';
end $$;

comment on function app.tg_deliverable_started_change_guard() is
  'ADR-0110 d.1: on a STARTED deliverable, type, quantity, department and due date change only when '
  'app.apply_deliverable_change_request writes them (flag app.change_request_apply). Name, priority, '
  'notes and every other column are untouched; an owner change carrying its department passes.';

create trigger deliverable_started_change_guard
  before update of deliverable_type_id, quantity, department_id, due_at on deliverables
  for each row execute function app.tg_deliverable_started_change_guard();

-- ============================================================================
-- 4) the rounds spent (d.1) — read, never stored on the deliverable
-- ============================================================================
create or replace function app.deliverable_rounds_spent(p_deliverable uuid) returns integer
language sql stable security definer
set search_path = public, app, extensions as $$
  select count(*)::integer from deliverable_change_requests r
   where r.deliverable_id = p_deliverable and r.round_spent
$$;
revoke execute on function app.deliverable_rounds_spent(uuid) from public, anon;
grant  execute on function app.deliverable_rounds_spent(uuid) to authenticated;

-- ============================================================================
-- 5) applying — the one writer the guard admits
-- ============================================================================
-- Not granted to anybody: called only by answer_change_request / resolve_change_request, which
-- have already decided the caller may. The deliverable's OWN guards still run with the caller's
-- identity (the edit guard's reach, and its refusal of a type change over live tasks — ADR-0052 d.6).
create or replace function app.apply_deliverable_change_request(p_request uuid, p_due_override date)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  r        deliverable_change_requests%rowtype;
  d        deliverables%rowtype;
  v_type   uuid;
  v_qty    integer;
  v_dept   uuid;
  v_due    timestamptz;
  v_has_due boolean;
  v_prior  text;
  v_prior2 text;
  v_w      text;
begin
  select * into r from deliverable_change_requests where id = p_request for update;
  select * into d from deliverables where id = r.deliverable_id for update;

  v_type := case when r.changes ? 'type' then (r.changes -> 'type' ->> 'to')::uuid else d.deliverable_type_id end;
  v_qty  := case when r.changes ? 'quantity' then (r.changes -> 'quantity' ->> 'to')::integer else d.quantity end;
  v_dept := case when r.changes ? 'department' then (r.changes -> 'department' ->> 'to')::uuid else d.department_id end;
  v_has_due := r.changes ? 'due' or p_due_override is not null;
  v_due  := case when p_due_override is not null then app.close_of_day(p_due_override)
                 when r.changes ? 'due' then app.close_of_day((r.changes -> 'due' ->> 'to')::date)
                 else d.due_at end;

  v_prior := coalesce(current_setting('app.change_request_apply', true), '');
  perform set_config('app.change_request_apply', 'on', true);
  -- the promise moves here on the owner's answer, not through the evidenced dialog (a question for
  -- Edward: ADR-0088 d.7a asks for the client's agreement on file) — logged below either way.
  v_prior2 := coalesce(current_setting('app.deliverable_due_at_change', true), '');
  if v_has_due then perform set_config('app.deliverable_due_at_change', 'on', true); end if;

  -- One write per field that the request names, so nothing it does not name is touched (a
  -- department write would otherwise re-fire the owner stamp on a deliverable it never asked about).
  if r.changes ? 'type' then
    update deliverables set deliverable_type_id = v_type where id = d.id;
  end if;
  if r.changes ? 'quantity' then
    update deliverables set quantity = v_qty where id = d.id;
  end if;
  if r.changes ? 'department' then
    update deliverables set department_id = v_dept where id = d.id;
  end if;
  if v_has_due then
    update deliverables set due_at = v_due where id = d.id;
  end if;

  perform set_config('app.deliverable_due_at_change', v_prior2, true);
  perform set_config('app.change_request_apply', v_prior, true);

  if r.changes ? 'department'
     and (select x.department_id from deliverables x where x.id = d.id) is distinct from v_dept then
    raise exception 'A deliverable''s department is its owner''s — this change needs an owner in that department.'
      using errcode = '22023', hint = 'change_request_department_follows_owner';
  end if;

  if v_has_due and v_due is distinct from d.due_at then
    v_w := coalesce(current_setting('app.sla_event_writer', true), '');
    perform set_config('app.sla_event_writer', 'on', true);
    insert into sla_events (tenant_id, deliverable_id, event_type, attributed_to, actor_user_id, payload)
    values (d.tenant_id, d.id, 'deadline_changed',
            case when r.asked_by = 'client' then 'client'::attribution_party end, auth.uid(),
            jsonb_build_object('from', d.due_at, 'to', v_due, 'change_request_id', r.id,
                               'asked_by', r.asked_by));
    perform set_config('app.sla_event_writer', v_w, true);
  end if;

  if r.asked_by = 'client' then
    update deliverable_change_requests set round_spent = true where id = r.id;
  end if;
end $$;

revoke execute on function app.apply_deliverable_change_request(uuid, date) from public, anon, authenticated;

-- ============================================================================
-- 6) asking (d.1)
-- ============================================================================
create or replace function public.request_deliverable_change(
  p_deliverable uuid,
  p_changes     jsonb,
  p_asked_by    text,
  p_cost        jsonb default null
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
  v_owner_dept uuid;
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
    raise exception 'say what should change: its type, quantity, department or due date' using errcode = '22023';
  end if;
  if exists (select 1 from deliverable_change_requests r
              where r.deliverable_id = p_deliverable and r.status in ('pending', 'pushed_back')) then
    raise exception 'a change request on this deliverable is already open — it is answered first'
      using errcode = '55000';
  end if;

  -- Each field: known, a real value, and different from today. `from` is read here, never taken.
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('type', 'quantity', 'department', 'due') then
      raise exception 'only the type, quantity, department and due date go through a change request — % saves as it is', v_key
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
      elsif v_key = 'department' then
        if not exists (select 1 from departments x where x.id = v_to::uuid and x.tenant_id = v_tenant) then
          raise exception 'that department is not in your organization' using errcode = '22023';
        end if;
        -- ADR-0102: the department is the owner's; a request that the stamp would undo is refused
        -- now, with the reason, rather than accepted and silently put back.
        select p.department_id into v_owner_dept from user_profiles p where p.id = d.owner_user_id;
        if v_owner_dept is not null and v_owner_dept <> v_to::uuid then
          raise exception 'A deliverable''s department is its owner''s — change its owner to someone in that department instead.'
            using errcode = '22023', hint = 'change_request_department_follows_owner';
        end if;
        v_from := d.department_id::text;
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
    (tenant_id, deliverable_id, requested_by, owner_user_id, changes, asked_by, cost)
  values (v_tenant, p_deliverable, v_actor, d.owner_user_id, v_changes, p_asked_by,
          coalesce(p_cost, '{}'::jsonb))
  returning id into v_id;

  if d.owner_user_id <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, d.owner_user_id, 'change_request_sent', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('change_request_id', v_id, 'changes', v_changes, 'asked_by', p_asked_by,
                               'cost', coalesce(p_cost, '{}'::jsonb)));
  end if;
  return v_id;
end $$;

comment on function public.request_deliverable_change(uuid, jsonb, text, jsonb) is
  'ADR-0110 d.1: ask the owner of a STARTED deliverable to change its type, quantity, department or '
  'due date. p_changes is {field: {to}} (or {field: value}); the server records from. p_asked_by is '
  'client | us. Whoever may edit the deliverable may ask. Tells the owner (change_request_sent).';

revoke execute on function public.request_deliverable_change(uuid, jsonb, text, jsonb) from public, anon;
grant  execute on function public.request_deliverable_change(uuid, jsonb, text, jsonb) to authenticated;

-- ============================================================================
-- 7) the owner answers (d.2)
-- ============================================================================
create or replace function public.answer_change_request(
  p_request uuid,
  p_answer  text,
  p_text    text default null,
  p_date    date default null
) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        deliverable_change_requests%rowtype;
  v_owner  uuid;
  v_name   text;
begin
  select * into r from deliverable_change_requests
   where id = p_request and tenant_id = v_tenant for update;
  if not found then raise exception 'change request % not found', p_request using errcode = 'P0002'; end if;

  select d.owner_user_id, d.name into v_owner, v_name from deliverables d where d.id = r.deliverable_id;
  if v_owner is distinct from v_actor then
    raise exception 'Only the deliverable''s owner answers a change request.%',
            app.refusal_ask(app.refusal_names_deliverable_owner(r.deliverable_id))
      using errcode = '42501',
            detail = coalesce(app.refusal_names_deliverable_owner(r.deliverable_id), ''),
            hint = 'answer_change_request';
  end if;
  if r.status <> 'pending' then
    raise exception 'this change request has already been answered' using errcode = '55000';
  end if;
  if p_answer is null or p_answer not in ('accept', 'decline', 'push_back') then
    raise exception 'accept, decline or push back' using errcode = '22023';
  end if;
  if p_answer = 'decline' and coalesce(trim(p_text), '') = '' then
    raise exception 'say why you are declining — the requester is told your reason' using errcode = '22023';
  end if;
  if p_answer = 'push_back' and coalesce(trim(p_text), '') = '' then
    raise exception 'say what you can do instead — a push-back is your words, and a date if you have one'
      using errcode = '22023';
  end if;

  if p_answer = 'accept' then
    perform app.apply_deliverable_change_request(p_request, null);
    update deliverable_change_requests
       set status = 'accepted', answered_by = v_actor, answered_at = now()
     where id = p_request;
  elsif p_answer = 'decline' then
    update deliverable_change_requests
       set status = 'declined', decline_reason = trim(p_text), answered_by = v_actor, answered_at = now()
     where id = p_request;
  else
    update deliverable_change_requests
       set status = 'pushed_back', counter_text = trim(p_text), counter_date = p_date,
           answered_by = v_actor, answered_at = now()
     where id = p_request;
  end if;

  if r.requested_by <> v_actor then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, r.requested_by, 'change_request_answered', v_name, 'deliverable', r.deliverable_id, v_actor,
            jsonb_build_object('change_request_id', p_request, 'answer', p_answer,
                               'reason', case when p_answer = 'decline' then trim(p_text) end,
                               'counter_text', case when p_answer = 'push_back' then trim(p_text) end,
                               'counter_date', case when p_answer = 'push_back' then p_date end,
                               'changes', r.changes));
  end if;
end $$;

comment on function public.answer_change_request(uuid, text, text, date) is
  'ADR-0110 d.2: the deliverable''s current owner answers a pending change request — accept (the '
  'change applies), decline (a reason), or push_back (words, an optional date). Tells the requester.';

revoke execute on function public.answer_change_request(uuid, text, text, date) from public, anon;
grant  execute on function public.answer_change_request(uuid, text, text, date) to authenticated;

-- ============================================================================
-- 8) the push-back is resolved (d.3); a declined one is closed
-- ============================================================================
create or replace function public.resolve_change_request(p_request uuid, p_resolution text)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        deliverable_change_requests%rowtype;
  v_owner  uuid;
  v_name   text;
begin
  select * into r from deliverable_change_requests
   where id = p_request and tenant_id = v_tenant for update;
  if not found then raise exception 'change request % not found', p_request using errcode = 'P0002'; end if;

  if r.requested_by <> v_actor and not app.is_deliverable_am_authority(r.deliverable_id) then
    raise exception 'Only the person who asked, or the campaign''s account manager, answers a push-back.%',
            app.refusal_ask(app.refusal_names_campaign_am(
              (select s.campaign_id from deliverables d join streams s on s.id = d.stream_id where d.id = r.deliverable_id)))
      using errcode = '42501', hint = 'resolve_change_request';
  end if;
  if r.status <> 'pushed_back' then
    raise exception 'only a pushed-back change request is accepted or withdrawn' using errcode = '55000';
  end if;
  if p_resolution is null or p_resolution not in ('accept_counter', 'withdraw') then
    raise exception 'accept her version, or withdraw the request' using errcode = '22023';
  end if;

  if p_resolution = 'accept_counter' then
    -- her date replaces the due date when she gave one; her words stay on the record
    perform app.apply_deliverable_change_request(p_request, r.counter_date);
    update deliverable_change_requests
       set status = 'counter_accepted', resolved_by = v_actor, resolved_at = now()
     where id = p_request;
  else
    update deliverable_change_requests
       set status = 'withdrawn', resolved_by = v_actor, resolved_at = now()
     where id = p_request;
  end if;

  select d.owner_user_id, d.name into v_owner, v_name from deliverables d where d.id = r.deliverable_id;
  -- To the owner who pushed back (the one who answered), and the current owner if that has changed.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v_tenant, u, 'change_request_resolved', v_name, 'deliverable', r.deliverable_id, v_actor,
         jsonb_build_object('change_request_id', p_request, 'resolution', p_resolution,
                            'counter_date', r.counter_date)
    from (select distinct u from unnest(array[r.answered_by, v_owner]) as u
           where u is not null and u <> v_actor) x;
end $$;

comment on function public.resolve_change_request(uuid, text) is
  'ADR-0110 d.3: the requester, or the campaign''s account-manager authority, answers a push-back — '
  'accept_counter (the change applies, her date replacing the due date when given) or withdraw '
  '(nothing changes, no round spent). Tells the owner. There is no insist.';

revoke execute on function public.resolve_change_request(uuid, text) from public, anon;
grant  execute on function public.resolve_change_request(uuid, text) to authenticated;

create or replace function public.close_change_request(p_request uuid)
returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_actor  uuid := auth.uid();
  r        deliverable_change_requests%rowtype;
begin
  select * into r from deliverable_change_requests
   where id = p_request and tenant_id = v_tenant for update;
  if not found then raise exception 'change request % not found', p_request using errcode = 'P0002'; end if;
  if r.requested_by <> v_actor and not app.is_deliverable_am_authority(r.deliverable_id) then
    raise exception 'Only the person who asked, or the campaign''s account manager, closes a declined change request.'
      using errcode = '42501', hint = 'close_change_request';
  end if;
  if r.status <> 'declined' or r.closed_at is not null then
    raise exception 'only a declined change request that is still open is closed' using errcode = '55000';
  end if;
  update deliverable_change_requests set closed_at = now() where id = p_request;
end $$;

comment on function public.close_change_request(uuid) is
  'ADR-0110 d.3 / I59 D3: Close on a declined change request — it leaves the requester''s Needs you. '
  'The requester or the campaign''s account-manager authority.';

revoke execute on function public.close_change_request(uuid) from public, anon;
grant  execute on function public.close_change_request(uuid) to authenticated;

-- ============================================================================
-- 9) Needs you
-- ============================================================================
create or replace function public.needs_me_change_requests()
returns table (
  id               uuid,
  my_part          text,        -- 'owner' (answer it) | 'requester' (resolve / close it)
  status           text,
  deliverable_id   uuid,
  deliverable_name text,
  campaign_id      uuid,
  campaign_name    text,
  requested_by     uuid,
  requested_by_name text,
  changes          jsonb,
  asked_by         text,
  cost             jsonb,
  decline_reason   text,
  counter_text     text,
  counter_date     date,
  answered_by      uuid,
  answered_by_name text,
  created_at       timestamptz,
  answered_at      timestamptz
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  select r.id,
         case when r.status = 'pending' then 'owner' else 'requester' end,
         r.status, r.deliverable_id, d.name, s.campaign_id, c.name,
         r.requested_by, rq.display_name, r.changes, r.asked_by, r.cost,
         r.decline_reason, r.counter_text, r.counter_date, r.answered_by, an.display_name,
         r.created_at, r.answered_at
    from deliverable_change_requests r
    join deliverables d on d.id = r.deliverable_id
    left join streams s on s.id = d.stream_id
    left join campaigns c on c.id = s.campaign_id
    left join user_profiles rq on rq.id = r.requested_by
    left join user_profiles an on an.id = r.answered_by
   where r.tenant_id = app.current_tenant_id()
     and ((r.status = 'pending' and d.owner_user_id = auth.uid())
          or (r.requested_by = auth.uid()
              and (r.status = 'pushed_back' or (r.status = 'declined' and r.closed_at is null))))
   order by r.created_at asc;
$$;

comment on function public.needs_me_change_requests() is
  'ADR-0110 / I59 D3: the change requests waiting on the caller — pending ones on deliverables they '
  'own now, and pushed-back or declined (not closed) ones they asked. Security invoker.';

revoke execute on function public.needs_me_change_requests() from public, anon;
grant  execute on function public.needs_me_change_requests() to authenticated;

commit;
