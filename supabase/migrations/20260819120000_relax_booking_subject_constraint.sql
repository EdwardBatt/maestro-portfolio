-- ADR-0029 (I7.2a follow-up): relax the booking "must have a subject" constraint.
--
-- 20260819110000 added `chk_bookings_has_subject`, but this system legitimately allows **plain
-- resource reservations** (resource + time only, no task) — so requiring a subject on every booking
-- wrongly rejects them. The ad-hoc "needs a title" rule belongs to the ad-hoc create flow (I7.2b),
-- not a blanket DB constraint. Drop it, and make the booking-assignment trigger skip when there's
-- no label so a plain reservation emits nothing. (Forward migration: 110000 was already applied, so
-- this corrects it rather than editing that file.)

alter table bookings drop constraint if exists chk_bookings_has_subject;

create or replace function app.tg_booking_notify_resource()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_user uuid; v_label text;
begin
  if new.sub_task_id is not null then return new; end if;   -- sub-task path carries the notification
  select user_id into v_user from resources where id = new.resource_id;
  if v_user is null or v_user is not distinct from auth.uid() then return new; end if;  -- equipment / self
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
