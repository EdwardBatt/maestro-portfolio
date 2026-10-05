-- ADR-0123 (I62.5 / I62.6) — "Ask the director to activate" (Figma CV-01, the account manager's draft row).
--
-- Anyone who manages clients starts a draft; only the account director activates it (d.1). The person who
-- started it asks, and the directors are told: the client records who asked and when, and every active
-- holder of `clients:approve` in the tenant gets a `client_activation_requested` notification that opens
-- the draft's Review step. Asking again tells them again. The one who asked is never told.
--
-- The notification is written by a SECURITY DEFINER trigger (search_path pinned), as every notification
-- is: `notifications` has no insert policy for `authenticated`. Recorded in ADR-0123's addendum.
--
-- `notifications_type_check` and `notifications_entity_type_check` are reproduced WHOLE from the latest
-- definition (20260926090000), cumulatively, plus `client_activation_requested` and entity `client`.

begin;

alter table public.clients
  add column activation_requested_at timestamptz,
  add column activation_requested_by uuid references user_profiles(id);

comment on column public.clients.activation_requested_at is
  'ADR-0123: when somebody last asked the account director to activate this draft (CV-01). Null: never asked.';

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in (
    'assigned', 'review_requested', 'changes_requested', 'signed_off', 'due_soon',
    'dependency_ready', 'cancelled', 'resource_clash', 'resource_required',
    'campaign_approved', 'deliverable_reassigned', 'rescheduled', 'chat_added',
    'task_reinstated', 'feedback_collected',
    'assignment_requested', 'assignment_approved', 'assignment_refused', 'assignment_superseded',
    'extension_requested', 'extension_approved', 'extension_refused',
    'deliverable_added',
    'deliverable_owner_removed', 'task_reassigned_away', 'feedback_requested',
    'assignment_overdue',
    'task_reopened', 'deliverable_reopened',
    -- I59
    'task_blocked', 'untimed_round', 'extension_forwarded',
    'change_request_sent', 'change_request_answered', 'change_request_resolved',
    'question_asked', 'question_replied', 'nudged', 'too_much', 'too_much_answered',
    'escalated', 'review_reminder', 'over_capacity', 'task_unblocked',
    -- I62 (ADR-0123)
    'client_activation_requested'
  ));
comment on constraint notifications_type_check on notifications is
  'I52 (17 Sep). Every value here needs COPY in notify-email AND `notifications.type.*` in EN and AR, '
  'or it is silently in-app only / renders its raw key; src/test/notification-copy.test.ts holds the '
  'three together. I59 (25 Sep) added fourteen values in one migration; I62 (28 Sep, ADR-0123) added '
  'client_activation_requested.';

alter table notifications drop constraint if exists notifications_entity_type_check;
alter table notifications add constraint notifications_entity_type_check
  check (entity_type in ('deliverable', 'sub_task', 'campaign', 'booking', 'resource', 'client'));

create or replace function app.tell_directors_a_client_waits()
returns trigger language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.status <> 'draft' or new.activation_requested_at is null
     or new.activation_requested_at is not distinct from old.activation_requested_at then
    return new;
  end if;
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select new.tenant_id, up.id, 'client_activation_requested', new.name, 'client', new.id, auth.uid()
    from user_profiles up
   where up.tenant_id = new.tenant_id
     and up.is_active
     and app.user_holds_permission(up.id, 'clients', 'approve')
     and up.id is distinct from auth.uid();
  return new;
end $$;

comment on function app.tell_directors_a_client_waits() is
  'ADR-0123: a draft client whose starter asked for activation tells every active holder of clients:approve '
  '(the account director; the Power Admin through the catalogue). Never the one who asked.';

revoke execute on function app.tell_directors_a_client_waits() from public;

create trigger clients_tell_directors
  after update of activation_requested_at on public.clients
  for each row execute function app.tell_directors_a_client_waits();

commit;
