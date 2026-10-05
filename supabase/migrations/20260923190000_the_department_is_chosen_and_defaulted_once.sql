-- A deliverable's department is CHOSEN; the owner only supplies a default, once, at creation.
--
-- ADR-0099 d.2 says a deliverable's department is its own and chosen, and is *"no longer stamped
-- from the owner"*. `20260923140000` took that literally and removed the derivation outright. The
-- pgTAP suite then showed what it had taken with it: **all four functions that create a deliverable**
-- — `add_campaign_deliverable`, `create_adhoc_deliverable`, `create_internal_project` and
-- `app.write_campaign_content` — set the owner and never the department, because the trigger had
-- always filled it in. Every one of them began producing work with no department, which is work
-- nobody can be assigned to.
--
-- **What the decision was actually for.** ADR-0099's context is explicit: the fault was that
-- changing an owner MOVED the work between departments, which refused a Creative lead her own team
-- member on 22 Sep (`I53.29`). The fault is the restamping, not the initial default.
--
-- So the rule becomes:
--
--   INSERT with a department   -> that department. A choice always wins.
--   INSERT without one         -> the owner's, as a convenience, exactly once.
--   INSERT into a workstream   -> the workstream's, which beats both (ADR-0099 d.3).
--   UPDATE                     -> never, unless the workstream changes (d.3), and never from
--                                 the owner. Changing who owns a deliverable cannot move it.
--
-- **This is a deviation from a literal reading of d.2 and it is flagged as one.** It keeps d.2's
-- purpose — the department is the deliverable's own, a choice is honoured, and naming somebody no
-- longer moves the work — while not requiring four RPCs and every caller of them to be changed in
-- the same migration that changes the rule. Section C's work screen will pass the department
-- explicitly (`I56.3`, `I56.8`), and when it does, the default below simply stops being reached.

begin;

create or replace function app.tg_deliverable_stamp_department()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
begin
  -- ADR-0099 d.3: the group fills the department in — on insert into one, or whenever the group
  -- changes. This is the convenience a workstream exists to provide, and it happens because a
  -- person put the deliverable in the group. It beats everything below.
  if new.workstream_id is not null
     and (tg_op = 'INSERT' or new.workstream_id is distinct from old.workstream_id) then
    select w.department_id into new.department_id
      from workstreams w where w.id = new.workstream_id;
    return new;
  end if;

  -- At CREATION only, and only when nobody said otherwise: the owner's department, as a starting
  -- point. A department passed in is a choice and is left exactly as it came.
  if tg_op = 'INSERT' and new.department_id is null and new.owner_user_id is not null then
    select p.department_id into new.department_id
      from user_profiles p where p.id = new.owner_user_id;
    return new;
  end if;

  -- ADR-0099 d.2/d.4: on UPDATE, nothing. Not from the owner — that derivation is what moved a
  -- deliverable's department when its owner changed, and refused a lead her own team member on
  -- 22 Sep. And not cleared when a group is removed: taking a deliverable out of a workstream
  -- changes the grouping and nothing else.
  return new;
end $$;

comment on function app.tg_deliverable_stamp_department() is
  'ADR-0099 d.2/d.3/d.4: a deliverable''s department is its OWN. A workstream sets it when the '
  'deliverable joins or moves between groups; otherwise the owner supplies a default once, at '
  'creation, and only when none was given. **Never on update** — ADR-0050 d.2''s restamping is what '
  'moved work between departments when an owner changed (I53.29, 22 Sep). A deviation from a '
  'literal d.2 is recorded in this migration''s header: the four create paths supply no department '
  'of their own yet, and section C''s screens will.';

commit;
