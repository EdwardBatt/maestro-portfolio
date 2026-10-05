-- I32.1 (ADR-0063 d.2) — the left rail: every conversation the caller may reach.
--
-- **Built from ENTITLED WORK, not from existing conversations.** A conversation is created lazily on
-- first open (ADR-0027 §2), so listing the `conversations` table would have shown four rows and no
-- campaigns on a month-old tenant and read as a broken screen. This returns a row for every anchor
-- the caller is entitled to, whether or not a thread has ever been opened on it; opening one
-- materialises it exactly as the panel does today.
--
-- **One source of truth with the gate.** Each candidate is filtered through
-- `app.can_read_conversation` — the same function `open()` calls — so the rail cannot list a
-- conversation the caller would then be refused, which is the failure ADR-0063 d.8 names: if the
-- list and the gate disagree, the list is wrong.
--
-- PERFORMANCE, stated rather than discovered later. The entitlement function is called once per
-- candidate deliverable (a few hundred at most on a live tenant), and each call walks that deliverable's tasks and
-- reviewers. That is tens of milliseconds today and it is O(n) in the tenant's deliverables.
-- ADR-0063's Consequences already flag that the rail "must be paginated once a tenant has real
-- volume"; when that day comes the fix is a set-based rewrite of the entitled set, NOT a cached
-- membership table, which is the thing ADR-0062 d.5 exists to prevent.

begin;

create or replace function public.my_conversations()
returns table (
  context_type    text,
  context_id      uuid,
  title           text,
  campaign_id     uuid,
  campaign_name   text,
  conversation_id uuid,
  last_message_at timestamptz,
  unread          integer
)
language sql stable
set search_path = public, app, extensions as $$
  with candidates as (
    -- Deliverables. Ad-hoc ones have no campaign and are grouped separately by the surface; that
    -- is a null here, never an exclusion (ADR-0063 d.3 — a campaign-first tree hides ad-hoc work,
    -- which is most of the alpha's).
    select 'deliverable'::text as ctx_type,
           d.id                as ctx_id,
           d.name              as ctx_title,
           coalesce(s.campaign_id, j.campaign_id) as camp_id
    from deliverables d
    left join streams s on s.id = d.stream_id
    left join jobs    j on j.id = d.job_id
    where d.tenant_id = app.current_tenant_id()
      and d.state <> 'archived'
    union all
    -- Campaign rooms.
    select 'campaign', c.id, c.name, c.id
    from campaigns c
    where c.tenant_id = app.current_tenant_id()
  ),
  entitled as (
    select * from candidates
    where app.can_read_conversation(ctx_type, ctx_id)
  )
  select
    e.ctx_type,
    e.ctx_id,
    e.ctx_title,
    e.camp_id,
    cam.name,
    cv.id,
    cv.last_message_at,
    -- Unread is measured against the caller's own cursor. No conversation, or no membership row
    -- yet, means nothing to have missed — never a phantom badge (ADR-0063 d.5).
    coalesce((
      select count(*)::int from messages m
      where m.conversation_id = cv.id
        and m.seq > coalesce(mem.last_read_seq, 0)
        and m.sender_id <> auth.uid()
    ), 0)
  from entitled e
  left join campaigns cam on cam.id = e.camp_id
  left join conversations cv
         on cv.tenant_id = app.current_tenant_id()
        and cv.context_type = e.ctx_type
        and cv.context_id = e.ctx_id
  left join conversation_members mem
         on mem.conversation_id = cv.id and mem.user_id = auth.uid()
$$;

comment on function public.my_conversations() is
  'ADR-0063 d.2: the chat rail — every anchor the caller is entitled to, whether or not a thread '
  'exists yet, with its campaign for grouping and the caller''s unread count. Filtered through '
  'app.can_read_conversation so the list and the gate can never disagree.';

revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated, service_role;

commit;
