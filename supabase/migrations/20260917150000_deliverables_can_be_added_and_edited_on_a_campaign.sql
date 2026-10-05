-- I52.20 / I52.21 (Edward, 17 Sep) — a deliverable can be added to a campaign or job after release,
-- and an existing one edited (name, type, quantity).
--
-- On production a campaign's deliverables were born without a type, so no task list ever
-- materialised (ADR-0052: the list comes from the type), and nothing on any page could set one —
-- deliverables were born in the wizard and never touched again. Likewise nothing could add a
-- deliverable to a campaign that already exists (`I48.43`'s general case).
--
-- Two doors, both under the campaign's approval authority — the account manager, or projects:manage
-- with reach over them (Power Admin, Traffic, Account Director), the same test app.approve_campaign
-- makes — because the deliverable list is the campaign's shape, which is the account manager's to
-- decide. Editing a single deliverable's words is wider: its owner and the leads in reach may too
-- (the rename rule of 20260917120000, now covering type and quantity as well).
--
--   * public.add_campaign_deliverable — inserts under the campaign's stream (or makes one, as the
--     wizard does), with owner, type, quantity, due. department_id is stamped from the owner
--     (ADR-0050); the type materialises the task list (ADR-0052); a due date past go-live is
--     recorded as an override the way the wizard records it (ADR-0093).
--   * public.update_campaign_deliverable — name, type, quantity. Setting a type on a deliverable
--     that has none materialises its tasks then (the trigger fires on the change). CHANGING a type
--     on a deliverable that already has live tasks is refused: ADR-0052 d.6 says a type change
--     never deletes, so a second list would be laid on top of the first — say so instead.
--   * app.tg_deliverable_edit_guard replaces the name guard: name, type and quantity under one rule.

begin;

-- ---------------------------------------------------------------- the rule ----
drop trigger if exists deliverable_name_guard on deliverables;
drop function if exists app.tg_deliverable_name_guard();

create or replace function app.tg_deliverable_edit_guard() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name
     and new.deliverable_type_id is not distinct from old.deliverable_type_id
     and new.quantity is not distinct from old.quantity then
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
     and exists (select 1 from sub_tasks t where t.deliverable_id = old.id and t.status not in ('done', 'cancelled')) then
    raise exception
      'this deliverable already has tasks from its type — cancel them first, or leave the type as it is'
      using errcode = '22023';
  end if;
  if old.owner_user_id = auth.uid()
     or app.deliverable_account_manager(old.id) = auth.uid()
     or (app.has_permission('project_tasks', 'manage')
         and app.in_write_scope(old.department_id, null, app.deliverable_account_manager(old.id))) then
    return new;
  end if;
  raise exception
    'editing this deliverable is outside your reach — its owner, its department''s leads or the account manager can'
    using errcode = '42501';
end $$;

comment on function app.tg_deliverable_edit_guard() is
  'I52.13 / I52.21: who may change a deliverable''s name, type or quantity — its owner, the '
  'campaign''s account manager, or project_tasks:manage within reach of its department. A blank name '
  'is refused; a type CHANGE on a deliverable with live tasks is refused (a second list would land on '
  'the first, ADR-0052 d.6). Held in Postgres so a PATCH and the RPCs are governed identically.';

create trigger deliverable_edit_guard
  before update of name, deliverable_type_id, quantity on deliverables
  for each row execute function app.tg_deliverable_edit_guard();

-- ---------------------------------------------------------------- edit ----
create or replace function public.update_campaign_deliverable(
  p_deliverable uuid, p_name text, p_type uuid, p_quantity integer)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare v_tenant uuid := app.current_tenant_id();
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if p_type is not null and not exists (
       select 1 from deliverable_types dt where dt.id = p_type and dt.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;
  update deliverables
     set name = trim(p_name),
         deliverable_type_id = p_type,
         quantity = greatest(coalesce(p_quantity, 1), 1)
   where id = p_deliverable;
  if not found then
    raise exception 'deliverable not found' using errcode = 'P0002';
  end if;
end $$;

comment on function public.update_campaign_deliverable(uuid, text, uuid, integer) is
  'I52.21: name, type and quantity of a deliverable. Adds no authority — app.tg_deliverable_edit_guard '
  'decides. Setting a type where there was none materialises the task list (ADR-0052).';

revoke execute on function public.update_campaign_deliverable(uuid, text, uuid, integer) from public, anon;
grant  execute on function public.update_campaign_deliverable(uuid, text, uuid, integer) to authenticated;

-- ---------------------------------------------------------------- add ----
create or replace function public.add_campaign_deliverable(
  p_campaign uuid, p_name text, p_owner uuid, p_type uuid default null, p_quantity integer default 1,
  p_due_at timestamptz default null, p_due_override jsonb default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaigns;
  v_am     uuid;
  v_stream uuid;
  v_id     uuid;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if v.status = 'closed' then
    raise exception 'this campaign is closed — reopen it before adding to it' using errcode = '22023';
  end if;
  -- The approval authority: the account manager, or projects:manage with reach over them.
  v_am := app.campaign_account_manager(p_campaign);
  if not (app.has_permission('projects', 'manage') and app.in_write_scope(null, null, v_am)) then
    raise exception
      'adding a deliverable to this campaign is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if p_owner is null or not exists (select 1 from user_profiles up where up.id = p_owner and up.tenant_id = v_tenant) then
    raise exception 'a deliverable needs an owner' using errcode = '22023';
  end if;
  if p_type is not null and not exists (
       select 1 from deliverable_types dt where dt.id = p_type and dt.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;

  -- The campaign's stream, as the wizard made it (one, named for the campaign); or one now.
  select s.id into v_stream from streams s where s.campaign_id = p_campaign order by s.created_at limit 1;
  if v_stream is null then
    insert into streams (tenant_id, campaign_id, name) values (v_tenant, p_campaign, v.name)
    returning id into v_stream;
  end if;

  -- SECURITY DEFINER for the insert — the caller may be an account manager whose role holds no
  -- write on deliverables of a department they do not reach; the authority test above is the
  -- campaign's, exactly as approval is. Actor columns and the owner-is-a-lead rule still apply.
  insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, deliverable_type_id, quantity)
  values (v_tenant, v_stream, trim(p_name), 'draft', p_due_at, p_owner, p_type, greatest(coalesce(p_quantity, 1), 1))
  returning id into v_id;

  -- ADR-0093: a tight / impossible / after-go-live date was warned about and proceeded with.
  if p_due_override is not null and jsonb_typeof(p_due_override) = 'object' and p_due_at is not null then
    perform app.record_due_date_override(
      v_id,
      (p_due_at at time zone 'Asia/Baghdad')::date,
      p_due_override ->> 'severity',
      (v.go_live_at at time zone 'UTC')::date,
      coalesce((p_due_override ->> 'workingDaysLeft')::int, 0),
      coalesce((p_due_override ->> 'requiredDays')::int, 0),
      nullif(p_due_override ->> 'outstandingHours', '')::numeric,
      nullif(p_due_override ->> 'capacityHours', '')::numeric);
  end if;
  return v_id;
end $$;

comment on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb) is
  'I52.20: add a deliverable to an existing campaign or job, under the approval authority (the '
  'account manager, or projects:manage with reach over them). Inserts under the campaign''s stream; '
  'the owner stamps the department (ADR-0050), the type materialises the tasks (ADR-0052), a '
  'warned-about due date is recorded (ADR-0093).';

revoke execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb) from public, anon;
grant  execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb) to authenticated;

commit;
