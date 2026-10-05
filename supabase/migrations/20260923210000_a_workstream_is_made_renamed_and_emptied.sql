-- The four things a person does to a workstream (I56.3, ADR-0099).
--
-- `20260923140000` made the table. This is the door: make one, rename it, move a deliverable
-- between groups, and remove a group. Written as RPCs rather than left to RLS, for the same reason
-- ADR-0096 d.4 wrote the phase ones that way — each carries a rule the policy cannot express:
--
--   * a group's department is required, and moving a deliverable into one SETS its department
--     (ADR-0099 d.3), which is the whole convenience the group exists to provide;
--   * removing a group that still holds work is refused WITH THE COUNT (d.8) — deleting a group
--     must never be a way to delete work;
--   * moving a deliverable takes its UNASSIGNED tasks with it and leaves the assigned ones where
--     they are (d.9), because somebody has committed to those.
--
-- Authority is the campaign's, the same predicate the phase RPCs use: its account manager, Traffic,
-- an Account Director or a Power Admin. Making a group is part of laying out a campaign's work, so
-- it is not a wider power than adding a deliverable already is.

begin;

-- ---------------------------------------------------------------- make / rename ----
create or replace function public.save_workstream(
  p_campaign    uuid,
  p_name        text,
  p_department  uuid,
  p_owner       uuid default null,
  p_workstream  uuid default null   -- null makes one; an id renames / re-owns that one
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_id     uuid;
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

  -- ADR-0099 d.3. Said as a sentence rather than left to the NOT NULL, because "null value in
  -- column department_id" is not something to show a person.
  if p_department is null then
    raise exception 'A workstream needs a department: it is what decides who can be given the work.'
      using errcode = '22023';
  end if;
  if not exists (select 1 from departments d where d.id = p_department and d.tenant_id = v_tenant) then
    raise exception 'that department is not in your organization' using errcode = '22023';
  end if;

  -- d.7: unique within the campaign, case-insensitively. Caught here so the message is a sentence;
  -- the unique index behind it is what makes it true under a race.
  if exists (
    select 1 from workstreams w
     where w.campaign_id = p_campaign
       and lower(trim(w.name)) = lower(trim(p_name))
       and (p_workstream is null or w.id <> p_workstream)
  ) then
    raise exception 'This campaign already has a workstream called "%".', trim(p_name)
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

  -- Changing a group's DEPARTMENT moves the work in it, exactly as adding work to it would
  -- (d.3). Doing anything else would leave a group in Creative holding Content's deliverables,
  -- which is the half-state this whole ADR exists to remove.
  update deliverables d
     set department_id = p_department
   where d.workstream_id = p_workstream
     and d.tenant_id = v_tenant
     and d.department_id is distinct from p_department;

  return p_workstream;
end $$;

comment on function public.save_workstream(uuid, text, uuid, uuid, uuid) is
  'ADR-0099 d.1/d.3/d.5/d.7 (I56.3): make a workstream, or rename and re-own one. A name is unique '
  'per campaign, case-insensitively; a department is required; changing the group''s department '
  'moves the work in it, because a group holding another department''s work is the half-state this '
  'ADR removes.';

revoke execute on function public.save_workstream(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.save_workstream(uuid, text, uuid, uuid, uuid) to authenticated;

-- ------------------------------------------------------------------------ move ----
create or replace function public.move_deliverable_to_workstream(
  p_deliverable uuid,
  p_workstream  uuid   -- null takes it OUT of its group (d.4)
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_dept     uuid;
begin
  select s.campaign_id into v_campaign
    from deliverables d join streams s on s.id = d.stream_id
   where d.id = p_deliverable and d.tenant_id = v_tenant;
  if v_campaign is null then
    raise exception 'deliverable % is not on a campaign', p_deliverable using errcode = 'P0002';
  end if;

  if not app.is_campaign_authority(v_campaign) then
    raise exception 'You cannot move this work between workstreams: it is outside your reach. Ask its account manager, an Account Director or Traffic.'
      using errcode = '42501', hint = 'move_deliverable_to_workstream';
  end if;

  if p_workstream is not null then
    select w.department_id into v_dept
      from workstreams w
     where w.id = p_workstream and w.tenant_id = v_tenant and w.campaign_id = v_campaign;
    if v_dept is null then
      raise exception 'workstream % is not on this campaign', p_workstream using errcode = 'P0002';
    end if;
  end if;

  -- d.3 sets the department on the way in; d.4 leaves it alone on the way out. The trigger
  -- `tg_deliverable_stamp_department` does both from this one write — which is why the department
  -- is not passed here: one rule, in one place.
  update deliverables set workstream_id = p_workstream where id = p_deliverable;

  -- d.9: the unassigned tasks follow. Already true — `tg_deliverable_tasks_follow_department`
  -- (20260922110000) does it whenever the deliverable's department changes, and leaves a task
  -- somebody is committed to where it is. Named here so the next reader does not add a second.
end $$;

comment on function public.move_deliverable_to_workstream(uuid, uuid) is
  'ADR-0099 d.3/d.4/d.9 (I56.3): put a deliverable in a workstream, or take it out. Going IN sets '
  'its department from the group and its unassigned tasks follow; coming OUT changes the grouping '
  'and nothing else — removing a grouping must never silently move work between departments.';

revoke execute on function public.move_deliverable_to_workstream(uuid, uuid) from public, anon;
grant execute on function public.move_deliverable_to_workstream(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------- remove ----
create or replace function public.remove_workstream(p_workstream uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_held     integer;
  v_name     text;
begin
  select w.campaign_id, w.name into v_campaign, v_name
    from workstreams w where w.id = p_workstream and w.tenant_id = v_tenant;
  if v_campaign is null then
    raise exception 'workstream % not found', p_workstream using errcode = 'P0002';
  end if;

  if not app.is_campaign_authority(v_campaign) then
    raise exception 'You cannot remove this workstream: it is outside your reach. Ask its account manager, an Account Director or Traffic.'
      using errcode = '42501', hint = 'remove_workstream';
  end if;

  -- ADR-0099 d.8: refused WITH THE COUNT. Deleting a group is not a way to delete work, and a
  -- refusal that does not say how much is in the way is a refusal somebody has to go and count.
  select count(*) into v_held from deliverables d
   where d.workstream_id = p_workstream and d.tenant_id = v_tenant;
  if v_held > 0 then
    raise exception 'The workstream "%" still holds % pieces of work. Move them out or remove them first.', v_name, v_held
      using errcode = '23503', hint = 'workstream_not_empty';
  end if;

  delete from workstreams where id = p_workstream;
end $$;

comment on function public.remove_workstream(uuid) is
  'ADR-0099 d.8 (I56.3): remove an EMPTY workstream. One still holding work is refused with the '
  'count — deleting a group must never be a way to delete work.';

revoke execute on function public.remove_workstream(uuid) from public, anon;
grant execute on function public.remove_workstream(uuid) to authenticated;

commit;
