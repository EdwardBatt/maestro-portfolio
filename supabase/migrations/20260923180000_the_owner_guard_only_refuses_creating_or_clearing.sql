-- The owner guard refuses CREATING work with no owner, and CLEARING one. Nothing else.
--
-- `20260923170000` refused any insert or update by a person where the owner was null. That is too
-- wide and the pgTAP suite proved it in one line:
--
--     /tests/015 — "scheduler: draft -> in_progress"
--     died: This deliverable needs an owner …
--
-- The test was not creating anything. It was moving an EXISTING owner-less deliverable through its
-- lifecycle, and the guard refused a state change for a fault the row already had. Thirteen suites
-- failed the same way. A rule meant to stop unowned work being made was instead freezing unowned
-- work that already exists — the worst of both, since the row stays and can now do nothing.
--
-- ADR-0100 d.8 is about the moment work is CREATED: *"every create path supplies one or is refused
-- by the database rather than by a dialog."* So:
--
--   INSERT        an owner and a department are required.
--   UPDATE        refused only if an owner or department is being REMOVED. A row that never had
--                 one is left alone to be edited, transitioned and eventually fixed.
--
-- Legacy rows are therefore not frozen, and no new unowned work can be made.

begin;

create or replace function app.tg_deliverable_requires_owner()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
begin
  -- Migrations, seeders and pgTAP fixtures escape, exactly as ADR-0040's assignment trigger and
  -- the owner guard do. Nothing a PERSON does reaches this branch.
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;

  -- Creating work: both are required.
  if tg_op = 'INSERT' then
    if new.owner_user_id is null then
      raise exception 'This deliverable needs an owner: somebody has to answer for it, and they are who approves its task list before anyone can be assigned.'
        using errcode = '23502', hint = 'deliverable_needs_owner';
    end if;
    if new.department_id is null then
      raise exception 'This deliverable needs a department: it is what decides who can be given the work.'
        using errcode = '23502', hint = 'deliverable_needs_department';
    end if;
    return new;
  end if;

  -- Changing it: only taking away what is there is refused. A row that never had an owner is not
  -- frozen by this rule — it is already wrong, and freezing it stops it being put right.
  if old.owner_user_id is not null and new.owner_user_id is null then
    raise exception 'A deliverable cannot be left without an owner: name somebody else instead.'
      using errcode = '23502', hint = 'deliverable_needs_owner';
  end if;
  if old.department_id is not null and new.department_id is null then
    raise exception 'A deliverable cannot be left without a department: it is what decides who can be given the work.'
      using errcode = '23502', hint = 'deliverable_needs_department';
  end if;

  return new;
end $$;

comment on function app.tg_deliverable_requires_owner() is
  'ADR-0100 d.8 and ADR-0099 d.2: work cannot be CREATED without an owner and a department, and '
  'neither can be taken away once set. An existing owner-less row is not frozen — the first '
  'attempt at this refused a state transition on one and failed thirteen suites, which is a rule '
  'about creation punishing rows that already exist.';

commit;
