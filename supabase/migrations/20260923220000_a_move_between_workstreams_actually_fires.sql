-- A move between workstreams has to make the triggers fire (ADR-0099 d.3/d.9).
--
-- Two one-word bugs in what landed earlier today, found by suite 150 rather than by reading:
--
--   deliverable_stamp_department        BEFORE INSERT OR UPDATE **OF owner_user_id**
--   deliverable_tasks_follow_department AFTER UPDATE **OF owner_user_id, department_id**
--
-- `tg_deliverable_stamp_department` was rewritten twice on 23 Sep to branch on
-- `new.workstream_id is distinct from old.workstream_id`, and `move_deliverable_to_workstream`
-- writes **only** `workstream_id`. A column-restricted trigger does not fire for a statement that
-- does not name its column — so the d.3 branch was unreachable on a move, and the whole convenience
-- a workstream exists to provide silently did nothing. The work joined the group and kept its old
-- department; its tasks, following the department that never changed, stayed put too (d.9).
--
-- **`20260922110000` already wrote this trap down** in its own header — *"a column a trigger sets is
-- not one the statement 'updated', so `of department_id` alone would never fire"* — and added
-- `owner_user_id` for the owner path. The workstream path needed the same word and did not get it.
--
-- Proved before and after in a throwaway container: as it stood, suite 150 failed 4 of 25; with the
-- first column list widened, two of the four passed; with both, 25 of 25 and the whole run green.
--
-- Also here, because it is the same screen and one line: the duplicate-name refusal echoed the name
-- the person had just typed rather than the one already on the campaign. Typing "always-on" against
-- an existing "Always-on" answered *…already has a workstream called "always-on"*, which does not
-- help anybody find the group that is in the way.

begin;

-- ADR-0099 d.3: joining or moving between groups is what sets a deliverable's department.
drop trigger if exists deliverable_stamp_department on deliverables;
create trigger deliverable_stamp_department
  before insert or update of owner_user_id, workstream_id, department_id on deliverables
  for each row execute function app.tg_deliverable_stamp_department();

-- ADR-0099 d.9 / I53.29: the unassigned tasks follow the deliverable's department. `workstream_id`
-- is named because the trigger above sets `department_id` in the SAME statement — and a column a
-- trigger sets is not one the statement "updated".
drop trigger if exists deliverable_tasks_follow_department on deliverables;
create trigger deliverable_tasks_follow_department
  after update of owner_user_id, department_id, workstream_id on deliverables
  for each row execute function app.tg_deliverable_tasks_follow_department();

-- ---------------------------------------------------------------------------------
-- The refusal names the group that is in the way, not the words that were typed.
-- ---------------------------------------------------------------------------------
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
    raise exception 'A workstream needs a department: it is what decides who can be given the work.'
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

  update deliverables d
     set department_id = p_department
   where d.workstream_id = p_workstream
     and d.tenant_id = v_tenant
     and d.department_id is distinct from p_department;

  return p_workstream;
end $$;

revoke execute on function public.save_workstream(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.save_workstream(uuid, text, uuid, uuid, uuid) to authenticated;

commit;
