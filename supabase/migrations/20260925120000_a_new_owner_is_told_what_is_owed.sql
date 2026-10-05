-- I57.44 (Edward, 25 Sep) — a new owner is told what is actually owed.
--
-- The owner-change notice said "review the brief and tasks and then approve" — the brief is gone
-- since ADR-0100, and an owner change does not reset the task-list approval, so a new owner of an
-- already-approved list was told to approve what was approved. The notice now RECORDS, at the moment
-- it is raised, whether the deliverable's work can already be assigned (`tasks_approved` in detail —
-- the same gate the schedule asks, `app.deliverable_work_acceptance_refusal`, so work approved before
-- the task-list cut-over counts as approved). The mail and the inbox read that one fact.
--
-- Reproduced WHOLE from 20260917110000 (grep confirmed the last definition); the only change is the
-- new owner's row carrying `detail`.

begin;

CREATE OR REPLACE FUNCTION app.tg_deliverable_owner_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
begin
  if new.owner_user_id is not distinct from old.owner_user_id then
    return null;
  end if;

  -- Nobody to tell when a migration or seeder moves it, and no actor to attribute it to.
  if auth.uid() is null or app.is_system_op() then
    return null;
  end if;

  -- I52 Action 2 (Edward, 17 Sep). The NEW owner is told what is now theirs — and, since I57.44,
  -- whether its task list still waits for them; the OLD owner is told, in one line, who has it now.
  -- Never the person who made the change.
  if new.owner_user_id is not null and new.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (new.tenant_id, new.owner_user_id, 'deliverable_reassigned', new.name, 'deliverable', new.id, auth.uid(),
            jsonb_build_object('tasks_approved', app.deliverable_work_acceptance_refusal(new.id) is null));
  end if;
  if old.owner_user_id is not null and old.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select new.tenant_id, old.owner_user_id, 'deliverable_owner_removed', new.name, 'deliverable', new.id, auth.uid(),
           jsonb_build_object('new_owner', up.display_name)
      from (select 1) x
      left join user_profiles up on up.id = new.owner_user_id;
  end if;

  return null;
end $function$;

commit;
