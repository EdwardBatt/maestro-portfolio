-- A deliverable's department follows its owner (ADR-0102, accepted 24 Sep; I57.18).
--
-- Edward, 24 Sep: "We need to assign to people, not departments… The dept should be based on the
-- assigned owner." This reverses ADR-0099 d.2/d.3 for the deliverable's department:
--
--   d.1  a deliverable's department is its OWNER's — at creation and on every owner change; it is
--        never chosen separately. A write that names another department is put back to the owner's.
--   d.2  a workstream no longer sets it: joining, moving between or leaving a group changes the
--        grouping only, and changing a group's department moves none of its work.
--   d.3  an owner with no department leaves the deliverable's department as it was.
--   d.4  tasks: an ASSIGNED task follows its assignee (ADR-0098 d.9); the deliverable's UNASSIGNED
--        tasks follow the deliverable, as they have since I53.29 — `deliverable_tasks_follow_department`
--        is unchanged and fires on the department this trigger sets.
--   d.5  live work is brought into line once (below); finished work keeps the department it finished in.
--
-- Why this is safe now when ADR-0099 turned it off: on 22 Sep an owner change moved a deliverable's
-- department and put its tasks out of a lead's reach. ADR-0098 (the same day) made reach independent
-- of the department — anyone who may book books anyone — so the move no longer refuses anybody.
-- If reach is ever narrowed to the department again, ADR-0102 must be revisited first.
--
-- The trigger keeps its column list (`owner_user_id, workstream_id, department_id`) — it is what
-- makes a workstream write or a direct department write fire, so either can be put back to the owner's.

begin;

-- ---------------------------------------------------------------- the stamp (d.1–d.3) ----
create or replace function app.tg_deliverable_stamp_department()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v_dept uuid;
begin
  -- d.1: the owner's department, whenever there is an owner who has one. On insert, on an owner
  -- change, and on any write that names a department of its own or moves the group — all put it
  -- back to the owner's, because the department is never chosen separately.
  if new.owner_user_id is not null then
    select p.department_id into v_dept from user_profiles p where p.id = new.owner_user_id;
    if v_dept is not null then
      new.department_id := v_dept;
    end if;
    -- d.3: an owner with no department leaves it as it was (or as the insert gave it).
  end if;
  -- d.2: a workstream does not set it. Nothing here reads `workstream_id`.
  return new;
end $$;

comment on function app.tg_deliverable_stamp_department() is
  'ADR-0102 d.1-d.3: a deliverable''s department is its owner''s — on insert, on an owner change, and '
  'on any write that names another department or moves the group. An owner with no department leaves '
  'it as it was. A workstream never sets it (supersedes ADR-0099 d.3).';

-- ------------------------------------------------------ a group's department (d.2) ----
-- Reproduced whole from 20260923220000 without the last step: changing a group's department used to
-- move every deliverable in it (ADR-0099 d.3). It moves none now; the group's department labels the
-- group and starts its owner picker (ADR-0099 d.5).
create or replace function public.save_workstream(
  p_campaign    uuid,
  p_name        text,
  p_department  uuid,
  p_owner       uuid default null,
  p_workstream  uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
  v_clash  text;
begin
  if not exists (select 1 from campaigns c where c.id = p_campaign and c.tenant_id = v_tenant) then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  if not app.is_campaign_authority(p_campaign) then
    raise exception 'You cannot change this campaign''s workstreams: it is outside your reach. Ask its account manager, an Account Director or Traffic.'
      using errcode = '42501', hint = 'save_workstream';
  end if;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'A workstream needs a name.' using errcode = '22023';
  end if;

  if p_department is null then
    raise exception 'A workstream needs a department: it labels the group and starts its owner list.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from departments d where d.id = p_department and d.tenant_id = v_tenant) then
    raise exception 'that department is not in your organization' using errcode = '22023';
  end if;

  -- d.7, and the message names the EXISTING group: "always-on" colliding with "Always-on" has to
  -- point at the one already there, or the person cannot find what is in their way.
  select w.name into v_clash
    from workstreams w
   where w.campaign_id = p_campaign
     and lower(trim(w.name)) = lower(trim(p_name))
     and (p_workstream is null or w.id <> p_workstream)
   limit 1;
  if v_clash is not null then
    raise exception 'This campaign already has a workstream called "%".', v_clash
      using errcode = '23505', hint = 'workstream_name_taken';
  end if;

  if p_workstream is null then
    insert into workstreams (tenant_id, campaign_id, name, department_id, owner_user_id)
    values (v_tenant, p_campaign, trim(p_name), p_department, p_owner)
    returning id into v_id;
    return v_id;
  end if;

  update workstreams
     set name = trim(p_name),
         department_id = p_department,
         owner_user_id = p_owner
   where id = p_workstream and tenant_id = v_tenant and campaign_id = p_campaign;
  if not found then
    raise exception 'workstream % not found on this campaign', p_workstream using errcode = 'P0002';
  end if;

  return p_workstream;
end $$;

comment on function public.save_workstream(uuid, text, uuid, uuid, uuid) is
  'ADR-0099 d.1/d.5/d.7, ADR-0102 d.2: make a workstream, or rename and re-own one. A name is unique '
  'per campaign, case-insensitively; a department is required and labels the group. Changing it moves '
  'none of the group''s deliverables — a deliverable''s department is its owner''s (ADR-0102 d.1).';

grant execute on function public.save_workstream(uuid, text, uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------- live work, once (d.5) ----
-- Every deliverable not yet approved, delivered or closed whose department is not its owner's is
-- put in its owner's department. The write fires the stamp (it names department_id) and the tasks
-- trigger, so the unassigned tasks follow; the audit trigger records each row. Finished work keeps
-- the department it finished in.
do $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(d.id order by d.id), '{}')
    into v_ids
    from deliverables d
    join user_profiles p on p.id = d.owner_user_id
   where p.department_id is not null
     and d.department_id is distinct from p.department_id
     and d.state not in ('approved', 'delivered', 'archived');

  update deliverables d
     set department_id = p.department_id
    from user_profiles p
   where p.id = d.owner_user_id
     and d.id = any (v_ids);

  raise notice 'ADR-0102 d.5: % live deliverable(s) moved to their owner''s department: %',
    coalesce(array_length(v_ids, 1), 0), v_ids;
end $$;

commit;
