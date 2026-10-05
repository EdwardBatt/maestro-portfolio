-- ADR-0118 addendum (Edward, 28 Sep — "A") — I65.4.
--
-- A deliverable closed only on a task APPROVAL (`app.maybe_complete_sub_task`, ADR-0077 d.2). When its other
-- tasks were approved first and the last open ones were cancelled or deleted after, nothing ran the roll-up:
-- the piece stayed In progress with every task settled, and with no Approve button (ADR-0118 d.2) there was no
-- way to close it. Seen walking K2/K4 on 28 Sep.
--
-- Cancelling a task (status -> cancelled) or deleting one now runs the same test the approval does: the
-- deliverable is In progress, no task is open, and at least ONE task was approved — a piece whose work was all
-- called off is never written as Approved (the guard's own reasoning, 20260927180000). It closes through the
-- ordinary update, so `app.tg_deliverable_transition_guard` sees it as the roll-up it is (ADR-0077 d.1) and
-- writes its bookkeeping as for any other close.
--
-- `security definer`, as `app.maybe_complete_sub_task` is: whoever may cancel a task closes its deliverable as
-- the roll-up, whether or not their own grants reach the deliverable row. Only `in_progress` is closed: the
-- guard's roll-up exemption is for that state, and a cancel must never fail because of the close it caused.

begin;

create or replace function app.tg_close_settled_deliverable()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_deliverable uuid;
begin
  if tg_op = 'DELETE' then
    v_deliverable := old.deliverable_id;
  else
    v_deliverable := new.deliverable_id;
  end if;

  update deliverables d
     set state = 'approved'
   where d.id = v_deliverable
     and d.state = 'in_progress'
     and not exists (select 1 from sub_tasks st
                      where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
     and exists (select 1 from sub_tasks st
                  where st.deliverable_id = d.id and st.status = 'done' and st.approved_at is not null);
  return null;
end $$;

comment on function app.tg_close_settled_deliverable() is
  'ADR-0118 addendum (I65.4): a task cancelled or deleted closes its deliverable when nothing under it is open '
  'and at least one task was approved — the roll-up an approval runs, for the other order.';

drop trigger if exists close_settled_deliverable_on_cancel on sub_tasks;
create trigger close_settled_deliverable_on_cancel
  after update of status on sub_tasks
  for each row
  when (new.status = 'cancelled' and old.status is distinct from 'cancelled')
  execute function app.tg_close_settled_deliverable();

drop trigger if exists close_settled_deliverable_on_delete on sub_tasks;
create trigger close_settled_deliverable_on_delete
  after delete on sub_tasks
  for each row
  execute function app.tg_close_settled_deliverable();

commit;
