-- ADR-0024 §7 + ADR-0026: in-app notifications, native Supabase.
--
-- Postgres is the source of truth (ADR-0015 §4): a business event inserts a durable notifications
-- row IN THE SAME TRANSACTION as the state change (via SECURITY DEFINER emission triggers), and a
-- best-effort broadcast nudges the recipient's inbox topic. A missed broadcast is recovered by the
-- client's reconcile query — so the broadcast is allowed to fail (swallowed) and realtime is never
-- required for correctness (it's also absent in CI).
--
-- The row stores TYPE + LABEL (the entity's name) + entity refs, not a localized sentence — the
-- client renders the copy from `type` via i18n. Email (Resend) is a separate slow lane (I5c).

create table notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid not null references user_profiles(id),   -- recipient
  seq         bigint generated always as identity,          -- per-user inbox ordering
  type        text not null
                check (type in ('assigned', 'review_requested', 'changes_requested', 'signed_off', 'blocked', 'due_soon')),
  label       text,                                          -- entity name for display (client builds the sentence)
  entity_type text check (entity_type in ('deliverable', 'sub_task', 'campaign')),
  entity_id   uuid,
  actor_id    uuid references user_profiles(id),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_notifications_user_recent on notifications (tenant_id, user_id, created_at desc);
create index idx_notifications_unread on notifications (user_id) where read_at is null;  -- unread badge
comment on table notifications is
  'ADR-0024/0026: recipient-scoped in-app notifications. Emitted in-transaction by SECURITY DEFINER triggers; best-effort broadcast to the user inbox topic; client renders copy from `type`.';

alter table notifications enable row level security;
alter table notifications force row level security;
-- recipient reads and marks their own; inserts happen only via the emission triggers (definer)
create policy notifications_recipient_select on notifications
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = auth.uid());
create policy notifications_recipient_update on notifications
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = app.current_tenant_id() and user_id = auth.uid());

-- ---- best-effort broadcast to the recipient's inbox topic ----
create or replace function app.tg_notification_broadcast()
returns trigger language plpgsql as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('id', new.id, 'seq', new.seq, 'type', new.type, 'label', new.label,
                         'entity_type', new.entity_type, 'entity_id', new.entity_id, 'created_at', new.created_at),
      'notification',
      'tenant:' || new.tenant_id::text || ':user:' || new.user_id::text,
      true
    );
  exception when others then null;  -- realtime absent (CI) or transient; the row is durable, client reconciles
  end;
  return new;
end $$;
comment on function app.tg_notification_broadcast() is
  'ADR-0015 §4: nudge the recipient inbox topic on a new notification. Best-effort — a failed broadcast is swallowed (row is the source of truth).';
create trigger notification_broadcast after insert on notifications
  for each row execute function app.tg_notification_broadcast();

-- ---- emission: sub-task assignment → notify the (new) assignee ----
-- SECURITY DEFINER so the trigger can insert a notification for a recipient other than the actor
-- (notifications has no client insert policy). Pinned search_path per AGENTS §6.
create or replace function app.tg_subtask_notify_assignee()
returns trigger language plpgsql security definer set search_path = public, app as $$
begin
  if new.assignee_id is not null
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id)
     and new.assignee_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
    values (new.tenant_id, new.assignee_id, 'assigned', new.title, 'sub_task', new.id, auth.uid());
  end if;
  return new;
end $$;
create trigger subtask_notify_assignee after insert or update of assignee_id on sub_tasks
  for each row execute function app.tg_subtask_notify_assignee();

-- ---- emission: deliverable state change → notify the working team + AM ----
create or replace function app.tg_deliverable_notify()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare v_type text;
begin
  if new.state = old.state then return new; end if;
  v_type := case
    when new.state = 'in_review' then 'review_requested'
    when old.state = 'in_review' and new.state = 'in_progress' then 'changes_requested'
    when new.state = 'approved' then 'signed_off'
    when new.state = 'blocked' then 'blocked'
    else null
  end;
  if v_type is null then return new; end if;

  -- recipients: the deliverable's sub-task assignees + the campaign's Account Manager, minus the actor
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select new.tenant_id, r.uid, v_type, new.name, 'deliverable', new.id, auth.uid()
  from (
    select distinct st.assignee_id as uid from sub_tasks st where st.deliverable_id = new.id and st.assignee_id is not null
    union
    select app.deliverable_account_manager(new.id) as uid
  ) r
  where r.uid is not null and r.uid is distinct from auth.uid();
  return new;
end $$;
create trigger deliverable_notify after update of state on deliverables
  for each row execute function app.tg_deliverable_notify();

-- ---- Realtime Authorization: a user may RECEIVE only on their own inbox topic ----
-- realtime.messages exists only on Supabase; guarded so CI is a clean no-op (see chat auth migration).
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (local/CI) — skipping notifications Realtime Authorization policy';
    return;
  end if;
  execute 'drop policy if exists notifications_user_receive_broadcast on realtime.messages';
  execute $pol$
    create policy notifications_user_receive_broadcast on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (select realtime.topic()) =
            'tenant:' || (auth.jwt() -> 'app_metadata' ->> 'tenant_id') || ':user:' || (auth.uid())::text
      )
  $pol$;
end $$;
