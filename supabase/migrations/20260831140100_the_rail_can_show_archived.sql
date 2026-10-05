-- I32.1 (ADR-0063 d.6, corrected) — archived work keeps its conversation, behind a toggle.
--
-- The first cut of the rail dropped `state = 'archived'` outright, and that left the SAME thread
-- visible in one place and invisible in another: the panel at the foot of a deliverable renders
-- whatever the state, so an archived deliverable's discussion stayed reachable there while
-- vanishing from `/chat`. Nobody decided that; it fell out of writing the two surfaces separately.
--
-- It is not hypothetical here. Seven ad-hoc deliverables are archived already, and ADR-0061
-- archives one automatically when its last live task is cancelled, so the set only grows.
--
-- Edward, 31 Aug: "Show Archived… Archived should be toggled to display or not as a list." So the
-- rail returns archived rows and MARKS them, and the surface decides — one group, collapsed, off by
-- default. The discussion about finished work stays part of its record, and the live list stays
-- about live work. Same shape the ad-hoc branch of `/deliverables` already uses: finished work is
-- shown read-only rather than hidden.

begin;

-- The signature gains `is_archived`, and `create or replace` cannot change a function's return
-- type — Postgres refuses with "cannot change return type of existing function". Dropped first,
-- exactly as `20260831140000` does for `conversation_people`.
drop function if exists public.my_conversations();

create or replace function public.my_conversations()
returns table (
  context_type    text,
  context_id      uuid,
  title           text,
  campaign_id     uuid,
  campaign_name   text,
  conversation_id uuid,
  last_message_at timestamptz,
  unread          integer,
  is_archived     boolean
)
language sql stable
set search_path = public, app, extensions as $$
  with candidates as (
    select 'deliverable'::text as ctx_type,
           d.id                as ctx_id,
           d.name              as ctx_title,
           coalesce(s.campaign_id, j.campaign_id) as camp_id,
           (d.state = 'archived') as archived
    from deliverables d
    left join streams s on s.id = d.stream_id
    left join jobs    j on j.id = d.job_id
    where d.tenant_id = app.current_tenant_id()
    union all
    -- A campaign room is never archived: a campaign has no archived state, and the room is where
    -- the whole campaign is discussed rather than any one finished artefact.
    select 'campaign', c.id, c.name, c.id, false
    from campaigns c
    where c.tenant_id = app.current_tenant_id()
  ),
  entitled as (
    select * from candidates
    where app.can_read_conversation(ctx_type, ctx_id)
  )
  select
    e.ctx_type, e.ctx_id, e.ctx_title, e.camp_id, cam.name, cv.id, cv.last_message_at,
    coalesce((
      select count(*)::int from messages m
      where m.conversation_id = cv.id
        and m.seq > coalesce(mem.last_read_seq, 0)
        and m.sender_id <> auth.uid()
    ), 0),
    e.archived
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
  'ADR-0063 d.2/d.6: the chat rail — every anchor the caller is entitled to, whether or not a thread '
  'exists yet, ARCHIVED ONES MARKED rather than dropped (the surface toggles them). Filtered through '
  'app.can_read_conversation so the list and the gate can never disagree.';

revoke execute on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated, service_role;

commit;
