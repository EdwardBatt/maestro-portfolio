-- A person required BY a task is told about it (ADR-0042 d.1).
--
-- THE GAP. `app.tg_booking_notify_resource` (20260819110000) opens with
-- `if new.sub_task_id is not null then return new` — sub-task bookings are skipped because the
-- sub-task's own assignment trigger already notifies the person the work was assigned to, and
-- notifying twice for one assignment is worse than not at all.
--
-- ADR-0042 broke that assumption. A task can now require a SECOND person ("task A also needs Sara
-- for two days"), and `subtask-schedule` books them with the task's `sub_task_id` — so the skip
-- caught them too. Sara's calendar filled up with work nobody had told her about, and the only way
-- to find out was to look at the grid and wonder. Silently occupying somebody's time is precisely
-- what the assignment and cancellation notifications exist to prevent.
--
-- WHY A NEW TYPE rather than reusing 'assigned'. She was not assigned anything. `sub_tasks` has one
-- `assignee_id` and ADR-0042 d.1 is explicit that a required person is additional resource on the
-- task, not a second owner — accountability does not split. A notification reading "You were
-- assigned to X" would say the opposite, and the person would reasonably act on it.
--
-- The no-double-notify rule is preserved exactly: if the booked resource belongs to the task's OWN
-- assignee, this still returns early and the sub-task trigger carries it.
--
-- search_path pinned inline per ADR-0033.

begin;

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required'));

-- Reproduced from **20260819120000**, which is the current definition — NOT from 20260819110000,
-- which created it. 20260819120000 added `if v_label is null then return new`, so a plain resource
-- reservation with no task and no title says nothing. Rebuilding from the older copy silently drops
-- that line and every plain reservation starts notifying; pgTAP 025 catches it, four assertions at
-- once, each off by exactly one.
--
-- (Written after doing precisely that. `docs/memory/traps.md` warns about reproducing a SEEDER from
-- the wrong base; it applies to any `create or replace` — check for later definitions first.)
--
-- Everything else — the equipment/self guards, the label resolution, the actor exclusion — is
-- unchanged from that version.
create or replace function app.tg_booking_notify_resource()
returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare
  v_user     uuid;
  v_label    text;
  v_assignee uuid;
begin
  select user_id into v_user from resources where id = new.resource_id;
  -- Equipment has no user to tell, and nobody needs telling about their own action.
  if v_user is null or v_user is not distinct from auth.uid() then return new; end if;

  if new.sub_task_id is not null then
    select assignee_id into v_assignee from sub_tasks where id = new.sub_task_id;

    -- The task's own assignee: the sub-task trigger already told them. No double-notify.
    if v_user is not distinct from v_assignee then return new; end if;

    -- Anyone else on a task booking is a REQUIRED resource (ADR-0042). Their time is being taken;
    -- they get told, and the label is the work they are needed on.
    -- No null-label guard needed here: sub_tasks.title is NOT NULL, so the coalesce always
    -- resolves. The guard below exists for plain reservations, which have neither.
    select coalesce(d.name, s.title) into v_label
    from sub_tasks s left join deliverables d on d.id = s.deliverable_id
    where s.id = new.sub_task_id;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (new.tenant_id, v_user, 'resource_required', v_label, 'sub_task', new.sub_task_id, auth.uid());
    return new;
  end if;

  if new.deliverable_id is not null then
    select name into v_label from deliverables where id = new.deliverable_id;
  else
    v_label := new.title;
  end if;
  if v_label is null then return new; end if;   -- plain reservation (no task/title) → nothing to say
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, v_user, 'assigned', v_label, 'booking', new.id, auth.uid());
  return new;
end $$;

comment on function app.tg_booking_notify_resource() is
  'ADR-0029 + ADR-0042: notify the booked resource''s user. A deliverable-level or ad-hoc booking '
  'notifies "assigned". A SUB-TASK booking notifies "resource_required" when the resource belongs to '
  'somebody other than the task''s assignee — they are required resource, not a second owner — and '
  'stays silent for the assignee themselves, whose sub-task trigger already carries it. Human '
  'resources only, actor excluded.';

commit;
