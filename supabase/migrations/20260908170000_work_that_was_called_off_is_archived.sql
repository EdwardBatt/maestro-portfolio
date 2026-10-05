-- I40.24 — a deliverable whose work was called off is archived.
--
-- Edward, 8 Sep: "there is a filter for 'no task yet', how is that even possible on the ad-hoc
-- list?" It is not — the schedule creates an ad-hoc deliverable WITH its task, so a moment where one
-- exists without the other never happens. Those rows were the 34 whose only task was CANCELLED, and
-- they were reading as work that had never been planned. The label is fixed in `src/`; this is the
-- other half: they do not belong in the live list at all. "They should be archived" (Edward).
--
-- SCOPED TO AD-HOC ON PURPOSE. `archived` is terminal — `when 'archived' then array[]` — so this is
-- irreversible, and it is applied only to the population Edward looked at and asked for. A CAMPAIGN
-- deliverable whose tasks are all cancelled may be a plan waiting for its work to be re-cut, and
-- guessing that on his behalf would be unrecoverable. If those should go too, that is a second,
-- deliberate migration.
--
-- NOT AUTOMATIC. This does not archive future ones. Cancelling the last task on a deliverable might
-- be followed by adding another, and an automatic rule would make that unrecoverable. Whether it
-- SHOULD become automatic is left open (`I40.24`) rather than decided by a migration.

begin;

set local app.system_op = 'on';

-- A correction first. `20260908150000` d.4 moved every `in_review` deliverable with no UNSETTLED
-- task to `approved` — and `cancelled` counts as settled, so a cancelled-only deliverable sitting in
-- `in_review` was swept up and recorded as approved. That is exactly the lie ADR-0077 d.6 refuses to
-- write, arriving through a clause written to fix something else. One row on the live tenant
-- ("Nesmet Ataa CC"); written as a condition rather than an id so it cannot matter how many.
--
-- Identified by what makes it wrong: marked approved, yet NOTHING on it was ever approved.
update deliverables d set state = 'archived'
 where d.state = 'approved'
   and d.stream_id is null
   and exists (select 1 from sub_tasks st
                where st.deliverable_id = d.id and st.status = 'cancelled')
   and not exists (select 1 from sub_tasks st
                    where st.deliverable_id = d.id
                      and st.status = 'done' and st.approved_at is not null);

-- The 34. Every task cancelled, nothing ever approved, and at least one task to begin with — which
-- is what separates "the work was called off" from "nothing was ever planned".
update deliverables d set state = 'archived'
 where d.stream_id is null
   and d.state in ('draft', 'in_progress', 'blocked')
   and exists (select 1 from sub_tasks st where st.deliverable_id = d.id)
   and not exists (select 1 from sub_tasks st
                    where st.deliverable_id = d.id and st.status <> 'cancelled');

commit;
