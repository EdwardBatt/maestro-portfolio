-- I70.2 / I70.3 (ADR-0133, accepted 30 Sep): deactivation has two stages. LEAVING starts the moment an admin
-- deactivates someone — sign-in is banned at once (update-user) — and lasts until everything they hold is handed
-- on; then DEACTIVATED (is_active = false). This migration lays the ground both stages stand on:
--
--   1. `user_profiles.leaving_since` / `leaving_started_by` — the Leaving stage. Written only by the hand-over's
--      own functions (which raise `app.system_op`) or the service role (update-user); a person cannot clear it on
--      themselves through `user_profiles_self_update` in the hour their token outlives the ban.
--   2. ADR-0133 d.1: a Leaving person is offered for NO new work — every place a person is given work refuses
--      them: a task's assignee, a reviewer, a deliverable's owner, a workstream's owner, a campaign's or a
--      client's account manager. On a CHANGE of person only, so what they already hold stays untouched.
--   3. The two new notices (`handover_list`, `deactivation_complete`) and the notice's new subject, the person
--      (`entity_type = 'user_profile'`).
--   4. Who receives the list (d.2) and what is on it (d.3), as internal helpers the hand-over functions read.
--
-- SECURITY DEFINER (AGENTS.md; ADR-0133 d.2–d.3 are the authority): `app.handover_recipients` and
-- `app.handover_items_of` read roles and work across the tenant to answer "who takes this person's work" and
-- "what do they hold" — facts the caller's own RLS may not show in full (a department lead cannot necessarily
-- read every client). They take the person's id, read only that person's tenant, and are not exposed to
-- `authenticated`: the public entry points (`public.handover_items`, `public.leaving_people`, next migration)
-- authorise the caller first. `search_path` pinned.

-- ---------------------------------------------------------------- 1. the Leaving stage ----
alter table user_profiles
  add column if not exists leaving_since timestamptz,
  add column if not exists leaving_started_by uuid references user_profiles(id);

comment on column user_profiles.leaving_since is
  'ADR-0133: when this person started leaving (access removed; work being handed over). Null = not leaving. '
  'Leaving = leaving_since is not null and is_active; Deactivated = is_active = false.';
comment on column user_profiles.leaving_started_by is 'ADR-0133: who deactivated them (the Leaving stage''s starter).';

create or replace function app.tg_user_leaving_is_system_written()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
begin
  if (new.leaving_since is distinct from old.leaving_since
      or new.leaving_started_by is distinct from old.leaving_started_by)
     and auth.uid() is not null and not app.is_system_op() then
    raise exception 'the leaving stage is set by deactivating someone, not by editing their profile'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists user_leaving_is_system_written on user_profiles;
create trigger user_leaving_is_system_written
  before update of leaving_since, leaving_started_by on user_profiles
  for each row execute function app.tg_user_leaving_is_system_written();

-- ---------------------------------------------------------------- 2. offered for no new work ----
-- One trigger function, told which column names the person (TG_ARGV[0]). A change TO a Leaving person is
-- refused with their name; anything else passes. Reads user_profiles under the caller's own RLS
-- (`user_profiles_tenant_select`: the whole tenant), so no definer is needed.
create or replace function app.tg_refuse_leaving_person()
returns trigger
language plpgsql
set search_path = public, app, extensions
as $$
declare
  v_new  uuid := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
  v_name text;
begin
  if v_new is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and v_new is not distinct from nullif(to_jsonb(old) ->> tg_argv[0], '')::uuid then
    return new;
  end if;
  select up.display_name into v_name
    from user_profiles up
   where up.id = v_new and up.leaving_since is not null and up.is_active;
  if found then
    raise exception '% is leaving and cannot be given new work', v_name
      using errcode = '22023', hint = 'person_leaving';
  end if;
  return new;
end $$;

comment on function app.tg_refuse_leaving_person() is
  'ADR-0133 d.1: a Leaving person is offered for no new work. BEFORE INSERT/UPDATE on the column named in TG_ARGV[0]; '
  'refuses a change TO a Leaving person (errcode 22023, hint person_leaving).';

drop trigger if exists sub_task_assignee_not_leaving on sub_tasks;
create trigger sub_task_assignee_not_leaving
  before insert or update of assignee_id on sub_tasks
  for each row execute function app.tg_refuse_leaving_person('assignee_id');

drop trigger if exists sub_task_reviewer_not_leaving on sub_task_reviewers;
create trigger sub_task_reviewer_not_leaving
  before insert or update of user_id on sub_task_reviewers
  for each row execute function app.tg_refuse_leaving_person('user_id');

drop trigger if exists deliverable_owner_not_leaving on deliverables;
create trigger deliverable_owner_not_leaving
  before insert or update of owner_user_id on deliverables
  for each row execute function app.tg_refuse_leaving_person('owner_user_id');

drop trigger if exists workstream_owner_not_leaving on workstreams;
create trigger workstream_owner_not_leaving
  before insert or update of owner_user_id on workstreams
  for each row execute function app.tg_refuse_leaving_person('owner_user_id');

drop trigger if exists campaign_account_manager_not_leaving on campaigns;
create trigger campaign_account_manager_not_leaving
  before insert or update of account_manager_id on campaigns
  for each row execute function app.tg_refuse_leaving_person('account_manager_id');

drop trigger if exists client_account_manager_not_leaving on clients;
create trigger client_account_manager_not_leaving
  before insert or update of account_manager_id on clients
  for each row execute function app.tg_refuse_leaving_person('account_manager_id');

-- ---------------------------------------------------------------- 3. the notices ----
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type = any (array[
  'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon', 'dependency_ready', 'cancelled',
  'resource_clash', 'resource_required', 'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
  'task_reinstated', 'feedback_collected', 'assignment_requested', 'assignment_approved', 'assignment_refused',
  'assignment_superseded', 'extension_requested', 'extension_approved', 'extension_refused', 'deliverable_added',
  'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested', 'assignment_overdue', 'task_reopened',
  'deliverable_reopened', 'task_blocked', 'untimed_round', 'extension_forwarded', 'change_request_sent',
  'change_request_answered', 'change_request_resolved', 'question_asked', 'question_replied', 'nudged', 'too_much',
  'too_much_answered', 'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
  'client_activation_requested', 'deliverable_type_changed', 'deliverable_edited',
  -- ADR-0133 d.2 / d.4
  'handover_list', 'deactivation_complete'
]::text[]));

alter table notifications drop constraint if exists notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check check (entity_type = any (array[
  'deliverable', 'sub_task', 'campaign', 'booking', 'resource', 'client',
  -- ADR-0133: the leaving person is the subject of the hand-over notices and its escalation.
  'user_profile'
]::text[]));

-- ---------------------------------------------------------------- 4a. who takes the list (d.2) ----
-- The department lead: an active, not-leaving holder of a department-scope role in the person's department, or
-- the Account Director there (Client Services' lead is its Account Director — live data, 26 Sep). Where there is
-- genuinely none, or the person leaving IS such a lead: every active, not-leaving Traffic Manager and Power Admin.
create or replace function app.handover_recipients(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  with p as (
    select up.id, up.tenant_id, up.department_id,
           exists (select 1 from roles r
                    where r.id = up.role_id and (r.scope = 'department' or r.key = 'account_director')) as is_lead
      from user_profiles up
     where up.id = p_user
  ), leads as (
    select l.id
      from p
      join user_profiles l on l.tenant_id = p.tenant_id and l.department_id = p.department_id
      join roles r on r.id = l.role_id
     where p.department_id is not null
       and not p.is_lead
       and (r.scope = 'department' or r.key = 'account_director')
       and l.is_active and l.leaving_since is null and l.id <> p.id
  )
  select id from leads
  union
  select l.id
    from p
    join user_profiles l on l.tenant_id = p.tenant_id
    join roles r on r.id = l.role_id
   where not exists (select 1 from leads)
     and r.key in ('scheduler', 'power_admin')
     and l.is_active and l.leaving_since is null and l.id <> p.id;
$$;

comment on function app.handover_recipients(uuid) is
  'ADR-0133 d.2: who receives a leaving person''s hand-over list — their department''s lead (department-scope role, or '
  'the Account Director); none, or the person is that lead, → every active Traffic Manager and Power Admin.';

-- ---------------------------------------------------------------- 4b. what they hold (d.3) ----
-- Only what someone must still take on. Finished work, given reviews and closed campaigns stay theirs on the record.
create or replace function app.handover_items_of(p_user uuid)
returns table (kind text, item_id uuid, label text, context text, detail jsonb)
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  -- 1. clients they are account manager for
  select 'client', cl.id, cl.name, null::text,
         jsonb_build_object('status', cl.status)
    from clients cl
   where cl.account_manager_id = p_user and not cl.is_internal
  union all
  -- 2. campaigns and jobs they are account manager for, not closed (a brief waiting on them among them)
  select 'campaign', c.id, c.name, cl.name,
         jsonb_build_object('status', c.status, 'kind', c.kind, 'waiting_on_them', c.status = 'pending_approval')
    from campaigns c
    left join clients cl on cl.id = c.client_id
   where c.account_manager_id = p_user and c.status <> 'closed'
  union all
  -- 3. deliverables they own, not finished (a task list waiting on their approval among them)
  select 'deliverable', d.id, d.name, c.name,
         jsonb_build_object('state', d.state, 'campaign_id', c.id,
                            'task_list_waiting', d.tasks_approved_at is null and c.status = 'approved')
    from deliverables d
    left join streams s on s.id = d.stream_id
    left join campaigns c on c.id = s.campaign_id
   where d.owner_user_id = p_user
     and d.state not in ('approved', 'delivered', 'archived')
     and coalesce(c.status, 'approved') <> 'closed'
  union all
  -- 4. workstreams they own, on a campaign still open
  select 'workstream', w.id, w.name, c.name,
         jsonb_build_object('campaign_id', c.id, 'department_id', w.department_id)
    from workstreams w
    join campaigns c on c.id = w.campaign_id
   where w.owner_user_id = p_user and c.status <> 'closed'
  union all
  -- 5. open tasks assigned to them (their future bookings go with each)
  select 'task', t.id, t.title, d.name,
         jsonb_build_object('status', t.status, 'due_at', t.due_at, 'deliverable_id', d.id, 'campaign_id', s.campaign_id,
                            'future_bookings', (select count(*) from bookings b
                                                 where b.sub_task_id = t.id and b.ends_at > now()
                                                   and b.state in ('soft_hold', 'tentative', 'confirmed')))
    from sub_tasks t
    left join deliverables d on d.id = t.deliverable_id
    left join streams s on s.id = d.stream_id
   where t.assignee_id = p_user and t.status not in ('done', 'cancelled')
  union all
  -- 6. reviews they are appointed to on open tasks, not yet given (the item is the appointment)
  select 'review', rv.id, t.title, d.name,
         jsonb_build_object('sub_task_id', t.id, 'status', t.status, 'deliverable_id', d.id, 'campaign_id', s.campaign_id)
    from sub_task_reviewers rv
    join sub_tasks t on t.id = rv.sub_task_id
    left join deliverables d on d.id = t.deliverable_id
    left join streams s on s.id = d.stream_id
   where rv.user_id = p_user
     and rv.approved_at is null and rv.responded_at is null
     and t.status not in ('done', 'cancelled');
$$;

comment on function app.handover_items_of(uuid) is
  'ADR-0133 d.3: what a person still holds that someone must take on — clients, campaigns and jobs, deliverables, '
  'workstreams, open tasks, reviews. Internal: the public readers authorise the caller.';

create or replace function app.handover_item_total(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select count(*)::int from app.handover_items_of(p_user);
$$;

create or replace function app.handover_item_counts(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
    from (select i.kind, count(*)::int as n from app.handover_items_of(p_user) i group by i.kind) k;
$$;

-- The one question an invoker path may ask about the caller: "is this person's hand-over mine?" — answered only for
-- `auth.uid()`, so it discloses nothing about anyone else (the Needs-you feed and `hand_over_item` read it).
create or replace function app.is_handover_recipient(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, extensions
as $$
  select auth.uid() is not null
     and exists (select 1 from user_profiles up
                  where up.id = p_user and up.leaving_since is not null and up.is_active
                    and up.tenant_id = app.current_tenant_id())
     and auth.uid() in (select app.handover_recipients(p_user));
$$;

revoke all on function app.is_handover_recipient(uuid) from public, anon;
grant execute on function app.is_handover_recipient(uuid) to authenticated;

revoke all on function app.handover_recipients(uuid)   from public, anon, authenticated;
revoke all on function app.handover_items_of(uuid)     from public, anon, authenticated;
revoke all on function app.handover_item_total(uuid)   from public, anon, authenticated;
revoke all on function app.handover_item_counts(uuid)  from public, anon, authenticated;
