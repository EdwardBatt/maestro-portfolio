-- I30.7 — A notification names the work AND the campaign it belongs to.
--
-- Edward, 8 Sep: "the task title should include the Project/Campaign Title… any reference to a
-- deliverable should always also include the Project/Campaign title." An email that says "Hero KV"
-- gives the reader no way to know which campaign that is, and the same deliverable name recurs
-- across campaigns.
--
-- WHY THIS IS ONE TRIGGER AND NOT FIFTEEN EDITS.
-- `notifications.label` is written by fifteen separate emitter functions, each choosing its own
-- text. Teaching all fifteen to join out to the campaign would be fifteen chances to get a join
-- wrong, and every emitter added later would have to remember. The notification already records
-- WHAT it is about (`entity_type` + `entity_id`), so the campaign is derivable from the row itself:
-- resolved once, here, on the way in. A new emitter inherits it by existing.
--
-- Stored, not resolved at read time, and deliberately: a notification is the record of a moment. If
-- the campaign is later renamed or the deliverable deleted, the email that was sent still says what
-- it said. That is the same reason `label` is stored.
--
-- Decisions taken with it (Edward, 8 Sep):
--   d.1  Format is `Campaign — Work`. The campaign is what orients the reader and it is the part
--        scanned first in a subject line. Rendering joins the two; the columns stay separate so a
--        surface that already has campaign context can show the work alone.
--   d.2  Ad-hoc work has no campaign and shows its title ALONE — no invented "Ad-hoc" prefix. The
--        absence of a campaign already says what it is, and roughly a third of the pilot is ad-hoc.
--   d.3  `resource_clash` keeps naming the RESOURCE and is left out of this entirely: a person is
--        not in a campaign. Its wording is its own job (notification-email-copy.md).
--
-- Also fixed here, the second half of the same decision: an assignment from the schedule names the
-- STEP that was assigned, not the container it sits in. `tg_booking_notify_resource` labelled a
-- required resource with `coalesce(d.name, s.title)` — the deliverable's name whenever there was
-- one — which is why an email read "has assigned you to 'Creative'". The task title is the work;
-- the deliverable is now context, where it belongs.
--
-- No RLS or audit clauses below: `notifications` is an existing table, its policies are unchanged,
-- and it is one of the four deliberate audit exemptions (AGENTS.md §6) — the notification IS the
-- record.

alter table notifications add column if not exists context_label text;

comment on column notifications.context_label is
  'I30.7: the campaign this notification''s subject belongs to, resolved from entity_type/entity_id '
  'by app.tg_notification_context on insert. NULL for ad-hoc work, for a campaign notification '
  '(the label is already the campaign) and for resource_clash (the label is a person or a thing). '
  'Rendered as "context — label"; kept as its own column so a surface that already knows the '
  'campaign can show the work alone.';

-- ---------------------------------------------------------------------------------------------
-- Resolve the campaign for a notification, from what the notification already says it is about.
--
-- SECURITY DEFINER because the emitters are: this runs inside their transaction, on rows they are
-- already entitled to write, and it reads names the recipient is about to be shown anyway. It
-- writes nothing but NEW.context_label. search_path pinned (ADR-0033).
--
-- Never raises. A notification that cannot resolve its campaign is a notification without context,
-- not a failed transaction — this trigger sits in the path of assignment, submission, approval and
-- cancellation, and none of those may fail because a name could not be found.
-- ---------------------------------------------------------------------------------------------
create or replace function app.tg_notification_context()
returns trigger language plpgsql security definer set search_path = public, app, extensions as $$
declare v_campaign text;
begin
  -- An explicit value from an emitter wins. Nothing sets one today; this is so a future emitter
  -- with better context than a join can provide is not overwritten by this trigger.
  if new.context_label is not null then return new; end if;

  begin
    if new.entity_type = 'sub_task' then
      select c.name into v_campaign
      from sub_tasks s
      join deliverables d on d.id = s.deliverable_id
      join streams st on st.id = d.stream_id
      join campaigns c on c.id = st.campaign_id
      where s.id = new.entity_id;

    elsif new.entity_type = 'deliverable' then
      select c.name into v_campaign
      from deliverables d
      join streams st on st.id = d.stream_id
      join campaigns c on c.id = st.campaign_id
      where d.id = new.entity_id;

    elsif new.entity_type = 'booking' then
      -- bookings carry campaign_id directly (20260819110000).
      select c.name into v_campaign
      from bookings b
      join campaigns c on c.id = b.campaign_id
      where b.id = new.entity_id;

    -- 'campaign': the label IS the campaign. Repeating it would read "Spring Launch — Spring
    -- Launch". Left null on purpose.
    end if;
  exception when others then
    v_campaign := null;   -- context is never worth failing an assignment for
  end;

  new.context_label := v_campaign;
  return new;
end $$;

comment on function app.tg_notification_context() is
  'I30.7: resolves the campaign name into notifications.context_label from entity_type/entity_id. '
  'Central so the fifteen emitter functions do not each carry the join, and so a new emitter '
  'inherits it. Ad-hoc work resolves to NULL by having no stream. Never raises.';

drop trigger if exists notification_context on notifications;
create trigger notification_context
  before insert on notifications
  for each row execute function app.tg_notification_context();

-- ---------------------------------------------------------------------------------------------
-- An assignment names the step that was assigned, not its container.
--
-- Reproduced from 20260826130000, which IS the current definition — checked, because traps.md
-- records the cost of rebuilding a function from the wrong base. The ONLY change is the label for
-- `resource_required`: `coalesce(d.name, s.title)` becomes `s.title`. Everything else — the
-- equipment guard, the self-notify guard, the assignee no-double-notify, the null-label guard for
-- plain reservations — is unchanged, and pgTAP 025 asserts all four.
-- ---------------------------------------------------------------------------------------------
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

    -- Anyone else on a task booking is a REQUIRED resource (ADR-0042). Their time is being taken,
    -- and the label is the WORK — the task they are needed on. It used to prefer the deliverable's
    -- name whenever the task had one, which is how an email came to say "assigned you to
    -- 'Creative'": the container, not the step. `sub_tasks.title` is NOT NULL, so this always
    -- resolves; the campaign now arrives separately in context_label.
    select s.title into v_label from sub_tasks s where s.id = new.sub_task_id;

    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (new.tenant_id, v_user, 'resource_required', v_label, 'sub_task', new.sub_task_id, auth.uid());
    return new;
  end if;

  -- No task on this booking, so the deliverable IS the thing assigned and its name is the label.
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
