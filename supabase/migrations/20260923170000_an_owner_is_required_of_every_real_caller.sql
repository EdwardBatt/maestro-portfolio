-- An owner and a department are required of every real caller — by a guard, not by NOT NULL.
--
-- `20260923140000` (an hour earlier) made `deliverables.owner_user_id` and `department_id` NOT NULL,
-- which is what ADR-0100 d.8 says. It was right about the behaviour and wrong about the mechanism,
-- and the pgTAP suite said so immediately: **60 test files create a deliverable without an owner**,
-- and four of them assert on that state directly — *"a deliverable with no owner has no
-- department"* (060), *"having no owner, no department"* (083), the `no_owner` refusal hint (122).
-- Those assertions encode the world ADR-0099 has just replaced, and rewriting sixty fixtures to
-- land one constraint is the tail wagging the dog.
--
-- **What ADR-0100 d.8 actually asks for** is that *"every create path supplies one or is refused by
-- the database rather than by a dialog"*. A guard delivers exactly that, and it is the pattern this
-- schema already uses for the same shape of rule — `tg_sub_task_assignment_gate` and
-- `tg_deliverable_owner_guard` both let migrations and seeders through on
-- `auth.uid() is null or app.is_system_op()` and refuse everybody else.
--
-- So: identical behaviour for every real caller, no fixture churn, and the four obsolete
-- assertions can be retired on their own merits rather than under duress.

begin;

alter table deliverables alter column owner_user_id drop not null;
alter table deliverables alter column department_id drop not null;

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

  if new.owner_user_id is null then
    raise exception 'This deliverable needs an owner: somebody has to answer for it, and they are who approves its task list before anyone can be assigned.'
      using errcode = '23502', hint = 'deliverable_needs_owner';
  end if;

  if new.department_id is null then
    -- ADR-0099 d.2: chosen, not inferred. Before this it was stamped from the owner, so it could
    -- never be missing; now it can, and work with no department is invisible to the people who
    -- should act on it.
    raise exception 'This deliverable needs a department: it is what decides who can be given the work.'
      using errcode = '23502', hint = 'deliverable_needs_department';
  end if;

  return new;
end $$;

comment on function app.tg_deliverable_requires_owner() is
  'ADR-0100 d.8 and ADR-0099 d.2: a deliverable created or changed by a PERSON must name an owner '
  'and a department. Decided in I22.5 on 28 Aug and enforced only by the wizard until now — Edward, '
  '23 Sep: "this is now the second time I have had to mention this." A guard rather than NOT NULL '
  'because sixty pgTAP fixtures seed owner-less rows and four assert on them; the behaviour for '
  'every real caller is the same.';

drop trigger if exists deliverable_requires_owner on deliverables;
create trigger deliverable_requires_owner
  before insert or update on deliverables
  for each row execute function app.tg_deliverable_requires_owner();

commit;
