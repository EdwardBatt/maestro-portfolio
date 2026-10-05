-- ADR-0029 (I7.2a): the booking becomes the assignment record; booking-assignment notifications.
--
-- A booking already ties a resource to a time; it now also carries the sub-task it assigns (or an
-- ad-hoc title). Assignment is one record reachable from the deliverable or the calendar. This
-- migration is the DB layer (columns, constraint, notification); the calendar create-flow and PM
-- booking authority (booking-transition function + RLS branch) land in I7.2b.

-- ---- 1. bookings carry an ad-hoc title (sub_task_id + its index already exist — the schema hook
--         from the deliverable-lifecycle migration; this completes the assignment model) ----
alter table bookings add column title text;
comment on column bookings.sub_task_id is
  'ADR-0029: the sub-task this booking assigns (its deliverable is implied). Sub-task bookings ride the sub-task assignment notification.';
comment on column bookings.title is
  'ADR-0029: ad-hoc booking label — required when no sub-task/deliverable/job is linked (a slot dropped straight on a resource).';

-- Every booking must have a subject: a linked entity (sub-task / deliverable / job) OR an ad-hoc
-- title. NOT VALID so pre-existing plain reservations aren't retro-broken; enforced on new writes.
alter table bookings add constraint chk_bookings_has_subject
  check (sub_task_id is not null or deliverable_id is not null or job_id is not null or title is not null) not valid;

-- ---- 2. notifications may reference a booking ----
alter table notifications drop constraint if exists notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check
  check (entity_type in ('deliverable', 'sub_task', 'campaign', 'booking'));

-- ---- 3. booking-assignment emission: notify the booked resource's user ----
-- Fires for DELIVERABLE-level and AD-HOC bookings only. SUB-TASK bookings are skipped — their
-- assignment notification is emitted by the sub-task trigger, so there's one notification per
-- assignment (no double-notify). Human resources only (equipment has no user); actor excluded; the
-- best-effort broadcast + email ride the existing notifications triggers. SECURITY DEFINER so it can
-- write a notification for a recipient other than the actor (AGENTS §6: pinned search_path).
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
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  values (new.tenant_id, v_user, 'assigned', v_label, 'booking', new.id, auth.uid());
  return new;
end $$;
comment on function app.tg_booking_notify_resource() is
  'ADR-0029: notify the booked resource''s user on a deliverable-level or ad-hoc booking (sub-task bookings ride the sub-task notification — no double-notify). Human resources only, actor excluded.';
create trigger booking_notify_resource after insert or update of resource_id on bookings
  for each row execute function app.tg_booking_notify_resource();
