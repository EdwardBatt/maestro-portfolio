-- An owner is required. A department is defaulted, not demanded.
--
-- `20260923180000` refused, at creation, any deliverable with no owner AND any with no department.
-- The owner half is Edward's, said twice (`I22.5` on 28 Aug and again on 23 Sep). The department
-- half was mine, inferred from ADR-0099 d.2's *"a deliverable must have a department"* — and it was
-- the wrong inference. Two reasons, both found by running the suite:
--
-- 1. **It is not a restoration, it is a new constraint.** ADR-0050 d.2's trigger set the department
--    to the owner's — and to NULL when the owner had none. So a deliverable whose owner had no
--    department has always had no department. Refusing it now does not close a hole that was ever
--    shut; it invents a rule and fails ten suites and `create_internal_project` on the way past.
--
-- 2. **In production it can never fire.** A deliverable's owner must be a lead (ADR-0083 d.9,
--    `tg_deliverable_owner_is_a_lead`) and a lead has a department. The refusal only ever reached
--    fixtures with unrealistic owners, so it bought no protection and cost a great deal of churn.
--
-- What remains is the rule that was actually asked for, and it is enforced by the database rather
-- than by a dialog:
--
--   INSERT   an owner is REQUIRED.
--   UPDATE   an owner or a department already set cannot be taken away.
--   the department is filled from the workstream, else from the owner, once, at creation.
--
-- ADR-0099 d.2 stands: the department is the deliverable's own and a choice is honoured. Making the
-- COLUMN mandatory is a separate change, and it needs the create paths to supply one first —
-- `I56.3` and `I56.8`, where the work screen asks for it.

begin;

create or replace function app.tg_deliverable_requires_owner()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions as $$
begin
  -- Migrations, seeders and pgTAP fixtures escape, exactly as ADR-0040's assignment trigger does.
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;

  -- Creating work with nobody answering for it: refused. They are who approves the task list
  -- (ADR-0100 d.2), so unowned work is work nobody can ever start.
  if tg_op = 'INSERT' and new.owner_user_id is null then
    raise exception 'This deliverable needs an owner: somebody has to answer for it, and they are who approves its task list before anyone can be assigned.'
      using errcode = '23502', hint = 'deliverable_needs_owner';
  end if;

  -- Taking away what is there: refused, both of them. A row that never had one is left alone —
  -- freezing it would stop it being put right.
  if tg_op = 'UPDATE' then
    if old.owner_user_id is not null and new.owner_user_id is null then
      raise exception 'A deliverable cannot be left without an owner: name somebody else instead.'
        using errcode = '23502', hint = 'deliverable_needs_owner';
    end if;
    if old.department_id is not null and new.department_id is null then
      raise exception 'A deliverable cannot be left without a department: it is what decides who can be given the work.'
        using errcode = '23502', hint = 'deliverable_needs_department';
    end if;
  end if;

  return new;
end $$;

comment on function app.tg_deliverable_requires_owner() is
  'ADR-0100 d.8: work cannot be created with nobody answering for it, and neither an owner nor a '
  'department can be taken away once set. A department is DEFAULTED at creation (from the '
  'workstream, else the owner) rather than demanded — demanding it was a new constraint, not a '
  'restoration, and in production it could never fire because an owner must be a lead and a lead '
  'has a department.';

commit;
