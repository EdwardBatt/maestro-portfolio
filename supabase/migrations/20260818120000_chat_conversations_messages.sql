-- ADR-0015 (§6) + ADR-0027: contextual chat spine — conversations, membership, messages.
--
-- Postgres is the source of truth; realtime is a lossy hint emitted by the `chat` Edge Function
-- (NOT a DB trigger), so this migration stays realtime-agnostic and applies cleanly in CI. The
-- reliability contract lives in the app: client-generated `id` (idempotency key), per-conversation
-- monotonic `seq` (assigned here), reconnect catch-up by `seq`. All message writes go through the
-- service-role `chat` function (persist-first insert → broadcast); clients get membership-gated
-- READS + their own read-cursor, nothing else (deny-by-default).
--
-- ADR-0027: a conversation is anchored to a context — a `campaign` room, or a
-- `deliverable`/`sub_task`/`review` thread — one per entity (partial unique index). `dm`/`group`
-- remain for people-shaped conversations.

create table conversations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  kind            text not null default 'group' check (kind in ('dm', 'group')),
  context_type    text not null default 'group'
                    check (context_type in ('campaign', 'deliverable', 'sub_task', 'review', 'dm', 'group')),
  context_id      uuid,                              -- the anchored entity (null for dm/group)
  title           text,
  created_by      uuid references user_profiles(id),
  created_at      timestamptz not null default now(),
  last_message_at timestamptz
);
create index idx_conversations_tenant_recent on conversations (tenant_id, last_message_at desc);
-- exactly one conversation per anchored entity (ADR-0027); dm/group exempt
create unique index uq_conversations_context on conversations (tenant_id, context_type, context_id)
  where context_id is not null;
comment on table conversations is
  'ADR-0015/0027: chat conversation. context_type/context_id anchor it to a campaign room or a deliverable/sub_task/review thread; one per entity.';

create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id       uuid not null references tenants(id),
  user_id         uuid not null references user_profiles(id),
  role            text not null default 'member' check (role in ('member', 'admin')),
  joined_at       timestamptz not null default now(),
  last_read_seq   bigint not null default 0,       -- coalesced read cursor (never per-message)
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
create index idx_conversation_members_user on conversation_members (tenant_id, user_id);

create table messages (
  id              uuid primary key,                 -- CLIENT-generated (crypto.randomUUID) idempotency key
  tenant_id       uuid not null references tenants(id),
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq             bigint not null,                  -- monotonic per conversation (trigger below)
  sender_id       uuid not null references user_profiles(id),
  body            text,
  edited_at       timestamptz,
  deleted_at      timestamptz,                      -- tombstone
  created_at      timestamptz not null default now(),
  unique (conversation_id, seq)
);
create index idx_messages_conversation_seq on messages (conversation_id, seq desc);

-- per-conversation monotonic seq, serialized by a per-conversation advisory lock
create or replace function app.tg_message_set_seq()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.conversation_id::text, 0));
  select coalesce(max(seq), 0) + 1 into new.seq from messages where conversation_id = new.conversation_id;
  return new;
end $$;
comment on function app.tg_message_set_seq() is
  'ADR-0015: BEFORE INSERT — stamp messages.seq = next per conversation, advisory-locked. Client never sets seq.';
create trigger message_set_seq before insert on messages
  for each row execute function app.tg_message_set_seq();

-- keep conversations.last_message_at hot for inbox sort
create or replace function app.tg_message_touch_conversation()
returns trigger language plpgsql as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;
create trigger message_touch_conversation after insert on messages
  for each row execute function app.tg_message_touch_conversation();

-- Membership check as SECURITY DEFINER so member-gated policies don't recurse through
-- conversation_members' own RLS (AGENTS §6: definer + pinned search_path).
create or replace function app.is_conversation_member(p_conversation uuid)
returns boolean language sql stable security definer set search_path = public, app as $$
  select exists (
    select 1 from conversation_members m
    where m.conversation_id = p_conversation and m.user_id = auth.uid()
  );
$$;
comment on function app.is_conversation_member(uuid) is
  'ADR-0015: is the caller a member of this conversation? SECURITY DEFINER to avoid RLS recursion in member-gated policies.';

-- ---- RLS: membership-gated reads; ALL writes via the service-role chat function ----
alter table conversations enable row level security;
alter table conversations force row level security;
create policy conversations_member_select on conversations
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_conversation_member(id));

alter table conversation_members enable row level security;
alter table conversation_members force row level security;
create policy conversation_members_select on conversation_members
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_conversation_member(conversation_id));
-- a member may update only their OWN row (read cursor / mute) — everything else is service-role
create policy conversation_members_self_update on conversation_members
  for update to authenticated
  using (tenant_id = app.current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = app.current_tenant_id() and user_id = auth.uid());

alter table messages enable row level security;
alter table messages force row level security;
create policy messages_member_select on messages
  for select to authenticated
  using (tenant_id = app.current_tenant_id() and app.is_conversation_member(conversation_id));
-- (no authenticated insert/update/delete: messages are written only by the chat Edge Function)

-- audit membership + conversation lifecycle (NOT every message — messages are their own log)
create trigger audit_row_change after insert or update or delete on conversations
  for each row execute function app.audit_row_change();
create trigger audit_row_change after insert or update or delete on conversation_members
  for each row execute function app.audit_row_change();
