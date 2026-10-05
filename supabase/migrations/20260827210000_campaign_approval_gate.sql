-- ADR-0048 d.8/d.9/d.10 (I16.5): a campaign is created pending, and nothing is assignable
-- until the account manager approves it.
--
-- WHY A TRIGGER AND NOT ONLY AN RPC. ADR-0043 put "every mandatory reviewer must approve"
-- inside `sub_task_approve`, and review found that a plain PostgREST update went straight
-- round it — the invariant lived in a function while the table knew nothing. The same mistake
-- here would be worse: the whole point of the gate is that AI-proposed work cannot become real
-- work without a person agreeing to it. So the gate is held by Postgres.
--
-- Streams and deliverables ARE created at submit, so the account manager has something to
-- review. What is blocked is *assignment* and *booking* — the two acts that turn a plan into
-- somebody's day.

alter table campaigns
  add column if not exists status text not null default 'pending_approval',
  add column if not exists approved_by uuid references user_profiles(id),
  add column if not exists approved_at timestamptz;

alter table campaigns drop constraint if exists chk_campaigns_status;
alter table campaigns add constraint chk_campaigns_status
  check (status in ('draft', 'pending_approval', 'approved'));

-- Every campaign that already exists is live work people are doing today. Marking those
-- pending would freeze the agency on deploy — the migration must not invent a backlog.
update campaigns set status = 'approved', approved_at = coalesce(approved_at, created_at)
 where status <> 'approved';

comment on column campaigns.status is
  'ADR-0048 d.8. draft -> pending_approval -> approved. Nothing on an unapproved campaign may '
  'be assigned or booked, held by a trigger rather than only by an RPC (the ADR-0043 lesson).';

create index if not exists idx_campaigns_status on campaigns (tenant_id, status)
  where status <> 'approved';

-- ---------------------------------------------------------------- resolving the campaign ----

-- A sub-task reaches its campaign through deliverable -> stream -> campaign. Ad-hoc work
-- (ADR-0035) hangs off a job with no stream, so it resolves to NULL and is NOT gated — it was
-- never planned by this wizard and has its own authority path.
create or replace function app.sub_task_campaign(p_sub_task uuid) returns uuid
language sql stable security definer
set search_path = public, app, extensions as $$
  select st.campaign_id
    from sub_tasks t
    join deliverables d on d.id = t.deliverable_id
    join streams st on st.id = d.stream_id
   where t.id = p_sub_task;
$$;

comment on function app.sub_task_campaign(uuid) is
  'ADR-0048 d.8: the campaign a sub-task belongs to, or NULL for ad-hoc work (no stream).';

create or replace function app.campaign_is_approved(p_campaign uuid) returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  -- NULL campaign means ad-hoc work, which this gate does not govern: true, not false.
  select p_campaign is null
      or exists (select 1 from campaigns c where c.id = p_campaign and c.status = 'approved');
$$;

-- ---------------------------------------------------------------- the gate ----

create or replace function app.tg_sub_task_assignment_gate() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_campaign uuid;
begin
  -- Only an ASSIGNMENT is gated. A pending campaign's tasks can still be created, renamed and
  -- re-dated while the account manager reads them — that is what reviewing is.
  if new.assignee_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  -- Migrations and seeders escape, the same way ADR-0040's assignment trigger lets them.
  if auth.uid() is null or app.is_system_op() then return new; end if;

  v_campaign := app.sub_task_campaign(new.id);
  if not app.campaign_is_approved(v_campaign) then
    raise exception
      'this campaign is waiting for the account manager to approve it, so its work cannot be assigned yet'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_sub_task_assignment_gate() is
  'ADR-0048 d.8, held by Postgres rather than only by an RPC: work on an unapproved campaign '
  'may not be assigned. Ad-hoc work (no stream, so no campaign) is not governed by this.';

create trigger sub_task_assignment_gate
  before insert or update of assignee_id on sub_tasks
  for each row execute function app.tg_sub_task_assignment_gate();

create or replace function app.tg_booking_campaign_gate() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v_campaign uuid;
begin
  if new.sub_task_id is null then return new; end if;
  if auth.uid() is null or app.is_system_op() then return new; end if;

  v_campaign := app.sub_task_campaign(new.sub_task_id);
  if not app.campaign_is_approved(v_campaign) then
    raise exception
      'this campaign is waiting for the account manager to approve it, so its work cannot be booked yet'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_booking_campaign_gate() is
  'ADR-0048 d.8: a booking is the other way a plan becomes somebody''s day, so it is gated too. '
  'Without this, subtask-schedule would happily consume capacity for unapproved work.';

create trigger booking_campaign_gate
  before insert on bookings
  for each row execute function app.tg_booking_campaign_gate();

-- ---------------------------------------------------------------- approval ----

create or replace function app.approve_campaign(p_campaign uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v campaigns; v_am uuid;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'this campaign is already approved' using errcode = '22023';
  end if;

  -- ADR-0048 d.9: the account manager approves. `app.deliverable_account_manager` resolves
  -- coalesce(campaign, client) elsewhere; here the campaign is the subject, so it is resolved
  -- directly rather than through a deliverable that may not exist yet.
  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if v_am is null or v_am is distinct from auth.uid() then
    raise exception 'only this campaign''s account manager can approve it'
      using errcode = '42501';
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- d.10: the author and the named owners are told the work is live.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, r.user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid()
    from sub_task_reviewers r
    join sub_tasks t on t.id = r.sub_task_id
    join deliverables d on d.id = t.deliverable_id
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign and r.user_id is distinct from auth.uid();
end $$;

create or replace function public.approve_campaign(p_campaign uuid) returns void
language sql security invoker
set search_path = public, app as $$
  select app.approve_campaign(p_campaign);
$$;
revoke execute on function public.approve_campaign(uuid) from public, anon;
grant execute on function public.approve_campaign(uuid) to authenticated;

-- Reproduced from **20260826130000**, which is the current definition — NOT from memory.
-- This constraint is drop-and-recreate, so anything omitted here is silently un-emittable
-- afterwards; writing it from recall dropped `dependency_ready` on the first attempt.
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved'));
