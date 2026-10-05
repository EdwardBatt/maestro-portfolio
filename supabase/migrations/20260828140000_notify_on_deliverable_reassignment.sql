-- I22.4 (ADR-0055 d.9) — a change of accountability is told to both people.
--
-- "A change of accountability nobody is told about is one that gets discovered at a deadline."
-- The outgoing owner needs to know work has left them; the incoming owner needs to know it has
-- arrived. Neither should find out from a dashboard count.
--
-- ALSO FIXES A LIVE BUG, unrelated to reassignment and found while writing this. `campaign_approved`
-- shipped on 27 Aug into the constraint below and was added to NEITHER `NotificationType` in
-- `src/features/notifications/api/notifications-api.ts` NOR the locale files — so an approved-campaign
-- notice renders in the inbox as the literal string `notifications.type.campaign_approved`. That is
-- precisely the `cancelled` bug of 24 Aug, and the comment warning about it sits directly above the
-- union it drifted from:
--
--   "Add a type to the DB check, this union, and both locale files together, or it half-works."
--
-- Both types are added in all three places in this change set.

begin;

-- Reproduced from **20260827210000**, the current definition — NOT from memory. This constraint is
-- drop-and-recreate, so anything omitted here becomes silently un-emittable; writing it from recall
-- dropped `dependency_ready` once already.
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved','deliverable_reassigned'));

create or replace function app.tg_deliverable_owner_notify() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.owner_user_id is not distinct from old.owner_user_id then
    return null;
  end if;

  -- Nobody to tell when a migration or seeder moves it, and no actor to attribute it to.
  if auth.uid() is null or app.is_system_op() then
    return null;
  end if;

  -- Both parties, never the person who did it — they already know, and a notification to
  -- yourself is noise that trains people to ignore the inbox.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select new.tenant_id, u, 'deliverable_reassigned', new.name, 'deliverable', new.id, auth.uid()
  from unnest(array[old.owner_user_id, new.owner_user_id]) as u
  where u is not null and u is distinct from auth.uid();

  return null;
end $$;

comment on function app.tg_deliverable_owner_notify() is
  'ADR-0055 d.9: tell the outgoing and incoming owners that a deliverable changed hands. AFTER '
  'trigger — it observes a write the owner guard has already allowed, and must never be able to '
  'refuse one. The actor is not notified of their own action.';

-- AFTER, so it cannot affect the write, and it only ever runs on a change the guard permitted.
create trigger deliverable_owner_notify
  after update of owner_user_id on deliverables
  for each row execute function app.tg_deliverable_owner_notify();

commit;
