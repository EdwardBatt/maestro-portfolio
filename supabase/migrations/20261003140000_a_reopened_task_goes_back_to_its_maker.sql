-- ADR-0142 (Edward, 3 Oct) — I74.18–I74.20. A re-opened task goes back to the person who made it; a client amendment
-- is counted.
--
--   d.1  A re-open carries a KIND: 'client_amendment' (the client asked for a fix on delivered work) or 'own_fix'.
--        `reopen_deliverable` / `reopen_task` take p_kind (default 'own_fix', so today's callers keep working) and an
--        optional p_hours for the round.
--   d.2  Every re-opened task goes back to its MAKER (reverses ADR-0121 d.1–d.2): the assignee and the reviewers stay;
--        the new due date and a fresh commitment are stamped; the old plan's bookings are released and the task is set
--        to start now, so `subtask-schedule` places it on the maker's week exactly as any assignment is placed — the
--        Edge Function is the only placer (spreadHours over the office calendar), so the reopen RETURNS the tasks to
--        place (`reschedule`: [sub_task_id]) and the client calls `subtask-schedule` for each, as it does after
--        `update_task_assignment`. The re-opener may place them (`app.may_place_task_bookings`) although the maker is
--        outside her own reach. The maker is told, with the reviewers (ADR-0121 d.3 stands).
--   d.3  Counted: `sub_task_reopenings` records every re-open with its kind, hours, piece, campaign and client;
--        `public.amendment_summary(p_month)` reads the client amendments per piece, campaign and client (count and
--        hours) for a month, or for all time.
--   d.4  Block time: `resource_unavailability` gains kind 'internal' and an optional `hours`, so internal work can count
--        in a person's hours; leave is unchanged. (The capacity readers still treat any unavailability row as its whole
--        span — see the report; no client capacity code is changed here.)
--
-- Reproduced WHOLE from their latest definitions (grep -liE "function +(public|app)\.<name>\b", 3 Oct):
--   app.reopen_one_task           20260927230000 (signature gains kind and hours: dropped and re-created)
--   public.reopen_deliverable     20260925100000 (idem)
--   public.reopen_task            20260925100000 (idem)
--   app.may_place_task_bookings   20261003120000
--   resource_unavailability_kind_check  20260728110500 (the table's own)
-- Safe on a populated database: the new kind widens a check; `hours` is a nullable column whose check every existing
-- row (hours null) satisfies; one new table.

begin;

-- ===================================================================== d.4: block time ====
alter table resource_unavailability drop constraint if exists resource_unavailability_kind_check;
alter table resource_unavailability add constraint resource_unavailability_kind_check
  check (kind in ('leave', 'maintenance', 'holiday', 'other', 'internal'));
alter table resource_unavailability add column if not exists hours numeric;
alter table resource_unavailability add constraint chk_resource_unavailability_hours
  check (hours is null or (hours > 0 and kind = 'internal'));
comment on column resource_unavailability.hours is
  'ADR-0142 d.4: for kind internal (Block time → Internal work), the hours it takes, so it counts in the person''s '
  'hours rather than blocking the whole span. Null for every other kind.';

-- ===================================================================== d.3: the record ====
create table sub_task_reopenings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  sub_task_id   uuid not null,
  deliverable_id uuid not null references deliverables(id) on delete cascade,
  campaign_id   uuid references campaigns(id) on delete set null,
  client_id     uuid references clients(id) on delete set null,
  kind          text not null check (kind in ('client_amendment', 'own_fix')),
  reason        text not null,
  due_at        timestamptz not null,
  hours         numeric check (hours is null or hours > 0),
  assignee_id   uuid references user_profiles(id),
  reopened_by   uuid references user_profiles(id),
  reopened_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid,
  updated_by    uuid,
  constraint fk_sub_task_reopenings_sub_task
    foreign key (tenant_id, sub_task_id) references sub_tasks (tenant_id, id) on delete cascade
);
comment on table sub_task_reopenings is
  'ADR-0142 d.3: every re-open of a task, with its kind (client_amendment | own_fix), the hours of the round, and the '
  'piece, campaign and client it counts against. Written only by app.reopen_one_task; a record — no user update or delete.';
create index idx_sub_task_reopenings_tenant_id on sub_task_reopenings (tenant_id);
create index idx_sub_task_reopenings_sub_task_id on sub_task_reopenings (sub_task_id);
create index idx_sub_task_reopenings_deliverable_id on sub_task_reopenings (deliverable_id);
create index idx_sub_task_reopenings_kind_month on sub_task_reopenings (tenant_id, kind, reopened_at);

alter table sub_task_reopenings enable row level security;
alter table sub_task_reopenings force row level security;
create policy sub_task_reopenings_tenant_select on sub_task_reopenings
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

create trigger audit_row_change
  after insert or update or delete on sub_task_reopenings
  for each row execute function app.audit_row_change();
create trigger set_updated_at before update on sub_task_reopenings
  for each row execute function app.set_updated_at();
create trigger set_actor_columns before insert or update on sub_task_reopenings
  for each row execute function app.set_actor_columns();

grant select on table public.sub_task_reopenings to authenticated;
grant select, insert, update, delete on table public.sub_task_reopenings to service_role;
revoke insert, update, delete on table public.sub_task_reopenings from authenticated, anon;

-- ===================================================================== d.2: back to its maker ====
-- Reproduced WHOLE from 20260927230000. Edits, each marked ADR-0142: the assignee stays; the task starts now and is due
-- on the new date, with a fresh commitment; the old plan's bookings are released for `subtask-schedule` to place the
-- new round; the hours of the round may be set; the maker is told with the reviewers; the re-open is recorded.
drop function if exists app.reopen_one_task(uuid, text, timestamptz);
create function app.reopen_one_task(p_sub_task uuid, p_reason text, p_due_at timestamptz,
                                    p_kind text default 'own_fix', p_hours numeric default null)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v sub_tasks;
  v_actor uuid := auth.uid();
  r record;
  v_campaign uuid;
  v_client uuid;
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
  if p_kind is null or p_kind not in ('client_amendment', 'own_fix') then
    raise exception 'say whether this is a client amendment or our own fix' using errcode = '22023', hint = 'kind_required';
  end if;
  if p_hours is not null and p_hours <= 0 then
    raise exception 'the hours of the round are more than nothing' using errcode = '22023';
  end if;

  -- The old round's plan goes; `subtask-schedule` places the new one on the maker's week (ADR-0142 d.2).
  delete from bookings where sub_task_id = p_sub_task;

  perform set_config('app.task_reopen', 'on', true);
  update sub_tasks
     set status              = 'todo',
         approved_at         = null,
         approved_by         = null,
         due_at              = p_due_at,
         -- ADR-0142 d.2: the maker keeps it; it starts now, on a fresh commitment to the new date.
         starts_at           = case when assignee_id is not null then least(now(), p_due_at) else null end,
         committed_starts_at = case when assignee_id is not null then least(now(), p_due_at) else null end,
         committed_due_at    = case when assignee_id is not null then app.commitment_instant(p_due_at) else null end,
         committed_hours     = case when assignee_id is not null then coalesce(p_hours, sla_hours) else null end,
         sla_hours           = coalesce(p_hours, sla_hours),
         schedule_overridden = false,
         revision_number     = coalesce(revision_number, 0) + 1
   where id = p_sub_task;
  perform set_config('app.task_reopen', 'off', true);
  -- The reviewers' answers are cleared by app.tg_subtask_clear_approvals (status left done).

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (v.tenant_id, v_actor, 'task_reopened', 'sub_tasks', v.id,
          jsonb_build_object('reason', p_reason, 'due_at', p_due_at, 'kind', p_kind, 'hours', p_hours,
                             'was_approved_at', v.approved_at, 'was_approved_by', v.approved_by,
                             'was_due_at', v.due_at, 'assignee', v.assignee_id,
                             'deliverable_id', v.deliverable_id));

  -- ADR-0142 d.3: on the record, against the piece, its campaign and its client.
  select coalesce(s.campaign_id, j.campaign_id), coalesce(c.client_id, j.client_id)
    into v_campaign, v_client
    from deliverables d
    left join streams s on s.id = d.stream_id
    left join jobs j on j.id = d.job_id
    left join campaigns c on c.id = coalesce(s.campaign_id, j.campaign_id)
   where d.id = v.deliverable_id;
  insert into sub_task_reopenings (tenant_id, sub_task_id, deliverable_id, campaign_id, client_id, kind, reason,
                                   due_at, hours, assignee_id, reopened_by)
  values (v.tenant_id, v.id, v.deliverable_id, v_campaign, v_client, p_kind, p_reason,
          p_due_at, coalesce(p_hours, v.sla_hours), v.assignee_id, v_actor);

  -- ADR-0142 d.2 (ADR-0121 d.3 stands): the maker and the reviewers are told — never the person who re-opened it.
  for r in
    select v.assignee_id as user_id, false as reviewer where v.assignee_id is not null
    union
    select rv.user_id, true from sub_task_reviewers rv where rv.sub_task_id = v.id
  loop
    if r.user_id is distinct from v_actor then
      insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
      values (v.tenant_id, r.user_id, 'task_reopened', v.title, 'sub_task', v.id, v_actor,
              jsonb_build_object('reason', p_reason, 'due_at', p_due_at, 'for_reviewer', r.reviewer, 'kind', p_kind));
    end if;
  end loop;
end $$;

revoke execute on function app.reopen_one_task(uuid, text, timestamptz, text, numeric) from public, anon, authenticated;

-- Reproduced WHOLE from 20260925100000. ADR-0142: the kind and the hours pass through to each task; the answer lists
-- the tasks to place (`reschedule`).
drop function if exists public.reopen_task(uuid, text, timestamptz);
drop function if exists public.reopen_deliverable(uuid, uuid[], text, timestamptz);
create function public.reopen_deliverable(
  p_deliverable uuid, p_tasks uuid[], p_reason text, p_due_at timestamptz,
  p_kind text default 'own_fix', p_hours numeric default null)
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
  v_place uuid[];
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
  -- ADR-0142 d.1
  if p_kind is null or p_kind not in ('client_amendment', 'own_fix') then
    raise exception 'say whether this is a client amendment or our own fix' using errcode = '22023', hint = 'kind_required';
  end if;

  -- d.4 first: the work cannot move inside a closed campaign.
  v_campaign_reopened := app.reopen_campaign_for(p_deliverable);

  if d.state in ('approved', 'delivered') then
    perform set_config('app.reopen', 'on', true);
    update deliverables set state = 'in_progress' where id = p_deliverable;
    perform set_config('app.reopen', 'off', true);
  end if;

  foreach v_task in array p_tasks loop
    perform app.reopen_one_task(v_task, trim(p_reason), p_due_at, p_kind, p_hours);
  end loop;

  select array_agg(st.title order by st.sort_order, st.unit_index) into v_titles
    from sub_tasks st where st.id = any(p_tasks);
  -- ADR-0142 d.2: the tasks with a maker, for `subtask-schedule` to place on her week.
  select coalesce(array_agg(st.id order by st.sort_order, st.unit_index), '{}') into v_place
    from sub_tasks st where st.id = any(p_tasks) and st.assignee_id is not null;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (d.tenant_id, v_actor, 'deliverable_reopened', 'deliverables', d.id,
          jsonb_build_object('reason', trim(p_reason), 'tasks', p_tasks, 'due_at', p_due_at, 'kind', p_kind,
                             'was_state', d.state, 'campaign_reopened', v_campaign_reopened));

  -- The owner is told what came back and why — unless they did it, or already heard as a task's
  -- assignee or reviewer.
  if d.owner_user_id is not null and d.owner_user_id is distinct from v_actor
     and not exists (select 1 from sub_tasks st where st.id = any(p_tasks) and st.assignee_id = d.owner_user_id)
     and not exists (select 1 from sub_task_reviewers rv where rv.sub_task_id = any(p_tasks) and rv.user_id = d.owner_user_id) then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (d.tenant_id, d.owner_user_id, 'deliverable_reopened', d.name, 'deliverable', d.id, v_actor,
            jsonb_build_object('reason', trim(p_reason), 'due_at', p_due_at, 'tasks', to_jsonb(v_titles),
                               'campaign_reopened', v_campaign_reopened, 'kind', p_kind));
  end if;

  return jsonb_build_object('reopened', cardinality(p_tasks), 'campaign_reopened', v_campaign_reopened,
                            'kind', p_kind, 'reschedule', to_jsonb(v_place));
end $$;

comment on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric) is
  'ADR-0103 d.2–d.4, ADR-0142: the picked tasks go back to To do WITH THEIR MAKER and reviewers (approval cleared, new '
  'due date and commitment, the old bookings released), the container to in_progress, a closed campaign re-opens; the '
  'maker, reviewers and owner are told. p_kind: client_amendment | own_fix (recorded in sub_task_reopenings). Returns '
  '{reopened, campaign_reopened, kind, reschedule: [sub_task_id]} — call subtask-schedule for each id in reschedule.';
revoke execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric) from public, anon;
grant  execute on function public.reopen_deliverable(uuid, uuid[], text, timestamptz, text, numeric) to authenticated;

-- A single task — the row's own Re-open. The same door, one task.
create function public.reopen_task(p_sub_task uuid, p_reason text, p_due_at timestamptz,
                                   p_kind text default 'own_fix', p_hours numeric default null)
returns jsonb
language sql
security invoker
set search_path = public, app, extensions
as $$
  select public.reopen_deliverable(
    (select st.deliverable_id from sub_tasks st where st.id = p_sub_task), array[p_sub_task], p_reason, p_due_at,
    p_kind, p_hours)
$$;

revoke execute on function public.reopen_task(uuid, text, timestamptz, text, numeric) from public, anon;
grant  execute on function public.reopen_task(uuid, text, timestamptz, text, numeric) to authenticated;

-- ===================================================================== d.2: the re-opener places the round ====
-- Reproduced from 20261003120000; ADR-0142 d.2: whoever re-opened a task may place its new round on the maker's
-- calendar (within the task's days, app.task_booking_sanctioned), as the client calls subtask-schedule after the reopen.
create or replace function app.may_place_task_bookings(p_sub_task uuid)
returns boolean language sql stable security definer cost 10000
set search_path = public, app, extensions as $$
  select p_sub_task is not null and exists (
    select 1 from public.sub_tasks t
     where t.id = p_sub_task and t.tenant_id = app.current_tenant_id() and t.assignee_id is not null
       and (exists (select 1 from public.sub_task_assignment_requests q
                     where q.sub_task_id = t.id and q.status = 'approved'
                       and q.requested_by = auth.uid() and q.assignee_id = t.assignee_id)
            -- ADR-0140 d.4
            or app.is_piece_owner(t.deliverable_id)
            -- ADR-0142 d.2: the round the caller re-opened, while its maker still holds it
            or exists (select 1 from public.sub_task_reopenings r
                        where r.sub_task_id = t.id and r.reopened_by = auth.uid()
                          and r.assignee_id = t.assignee_id
                          and r.reopened_at = (select max(r2.reopened_at) from public.sub_task_reopenings r2
                                                where r2.sub_task_id = t.id))))
$$;
comment on function app.may_place_task_bookings(uuid) is
  'ADR-0139 d.4 / ADR-0140 d.4 / ADR-0142 d.2: the caller may materialise (and clear) this task''s bookings for its '
  'current person although that person is outside their scheduling reach — they asked and the lead booked or offered '
  'it, they own the piece, or they re-opened its current round.';

-- ===================================================================== d.3: counted and shown ====
-- Client amendments per piece, campaign and client — count and hours — for one month (p_month: any day in it, Baghdad
-- months) or, with null, for all time. Security INVOKER: the caller's own RLS (tenant-wide reads, like every per-piece
-- record) decides what is counted.
create or replace function public.amendment_summary(p_month date default null)
returns table (level text, id uuid, name text, amendments bigint, hours numeric)
language sql stable security invoker
set search_path = public, app, extensions as $$
  with a as (
    select r.deliverable_id, r.campaign_id, r.client_id, r.hours
      from sub_task_reopenings r
     where r.kind = 'client_amendment'
       and (p_month is null
            or ((r.reopened_at at time zone 'Asia/Baghdad')::date >= date_trunc('month', p_month)::date
                and (r.reopened_at at time zone 'Asia/Baghdad')::date < (date_trunc('month', p_month) + interval '1 month')::date))
  )
  select 'deliverable'::text, a.deliverable_id, d.name, count(*), coalesce(sum(a.hours), 0)
    from a join deliverables d on d.id = a.deliverable_id
   group by a.deliverable_id, d.name
  union all
  select 'campaign', a.campaign_id, c.name, count(*), coalesce(sum(a.hours), 0)
    from a join campaigns c on c.id = a.campaign_id
   group by a.campaign_id, c.name
  union all
  select 'client', a.client_id, cl.name, count(*), coalesce(sum(a.hours), 0)
    from a join clients cl on cl.id = a.client_id
   group by a.client_id, cl.name
$$;
comment on function public.amendment_summary(date) is
  'ADR-0142 d.3: client amendments (re-opens of kind client_amendment) counted per piece (level deliverable), campaign '
  'and client, with their hours — for the month containing p_month (Baghdad), or all time when null. Invoker.';
revoke execute on function public.amendment_summary(date) from public, anon;
grant  execute on function public.amendment_summary(date) to authenticated;

commit;
