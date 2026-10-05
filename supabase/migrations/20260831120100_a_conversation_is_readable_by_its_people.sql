-- I31.1/I31.3 (ADR-0062) — who is entitled to a conversation, decided once, in Postgres.
--
-- THE BUG THIS REPLACES. `chat/index.ts` decided this itself, in two functions. `onCampaignTeam`
-- admitted four kinds of person — `project_tasks:manage`, `projects:manage`, the campaign's account
-- manager, and anyone with `assignee_id = auth.uid()` on a sub-task under the campaign. Grep it for
-- `reviewer`: no match. A REVIEWER WAS NEVER ON THE TEAM, so the one surface where two people must
-- talk is the one it refused. Measured on the live tenant: a large share of users refused —
-- the C-suite and every Team Member. Three more defects of the same family: the assignee
-- query embedded `deliverables!inner(streams!inner(campaign_id))` and so walked ONLY streams, while
-- `resolveCampaign` twelve lines above correctly followed `stream_id` OR `job_id`; ad-hoc work 404d
-- because the Ad-hoc job carries no campaign; and all of it rendered one string.
--
-- WHY IT MOVES INTO THE DATABASE. ADR-0062 d.3 requires `app.in_write_scope`, which lives in `app`
-- and is not reachable over PostgREST, so an Edge Function cannot evaluate the scope axis itself
-- however it is written. Deciding here also means ADR-0037 holds — one primitive, one call path —
-- and, decisively, that pgTAP can prove the rule (I31.8). The Edge Function keeps `contextMembers`
-- in `_shared/` per d.1; it is now a thin caller of these doorways rather than a second opinion.
--
-- SECURITY DEFINER is authorised by ADR-0062 (AGENTS.md §6 requires an ADR; d.1–d.4 are it). It is
-- needed because the participant walk reads `sub_tasks`, `sub_task_reviewers`, `deliverables` and
-- `campaigns` — tables whose own RLS would otherwise hide from a caller exactly the rows that decide
-- whether they may read the thread, which is circular. Every function pins `search_path`
-- (ADR-0033) and every one re-applies the tenant fence itself rather than inheriting one.
--
-- WHAT IS NOT HERE. `chat_oversight:view` is seeded by `20260831120000`. The frontend surface, the
-- add/remove ops and the notification are I31.4/I31.7.

begin;

-- ---------------------------------------------------------------- the anchor ----

-- Every deliverable a context covers. A campaign covers all of them, through EITHER anchor —
-- `streams.campaign_id` for campaign work and `jobs.campaign_id` for job-anchored work. Walking
-- only streams is the exact bug being fixed, so both are here and a test covers each.
create or replace function app.conversation_deliverables(p_context_type text, p_context_id uuid)
returns table (deliverable_id uuid)
language sql stable security definer
set search_path = public, app, extensions as $$
  select d.id
  from deliverables d
  where d.tenant_id = app.current_tenant_id()
    and case p_context_type
      when 'campaign' then
        coalesce(
          (select s.campaign_id from streams s where s.id = d.stream_id),
          (select j.campaign_id from jobs   j where j.id = d.job_id)
        ) = p_context_id
      -- A review thread is anchored to its deliverable, exactly as ADR-0027 §1 defines it.
      when 'deliverable' then d.id = p_context_id
      when 'review'      then d.id = p_context_id
      when 'sub_task'    then d.id = (select st.deliverable_id from sub_tasks st where st.id = p_context_id)
      else false
    end
$$;
comment on function app.conversation_deliverables(text, uuid) is
  'ADR-0062: the deliverables a conversation context covers. Follows BOTH stream_id and job_id for a '
  'campaign anchor — walking only streams denied assignees on job-anchored work (I31.1).';

-- The owning campaign, or null. Ad-hoc work legitimately has none, and that is no longer a refusal:
-- ADR-0062 d.1 — 404 only when the anchor resolves to NOBODY, never merely for having no campaign.
create or replace function app.conversation_campaign(p_context_type text, p_context_id uuid)
returns uuid
language sql stable security definer
set search_path = public, app, extensions as $$
  select case when p_context_type = 'campaign' then p_context_id else (
    select coalesce(
             (select s.campaign_id from streams s where s.id = d.stream_id),
             (select j.campaign_id from jobs   j where j.id = d.job_id))
    from deliverables d
    where d.id in (select deliverable_id from app.conversation_deliverables(p_context_type, p_context_id))
      and d.tenant_id = app.current_tenant_id()
    limit 1
  ) end
$$;
comment on function app.conversation_campaign(text, uuid) is
  'ADR-0062: the campaign owning a conversation context, or NULL for ad-hoc work. Null is not a '
  'refusal — it is simply the absence of one of several ways to be entitled.';

-- ---------------------------------------------------------------- the people ----

-- Everyone NAMED ON THE WORK, with the reason. The reason is not decoration: ADR-0063 d.8 shows it
-- beside each person, because "who is here" is far less useful than "why is the CFO here".
create or replace function app.conversation_participants(p_context_type text, p_context_id uuid)
returns table (user_id uuid, reason text)
language sql stable security definer
set search_path = public, app, extensions as $$
  with dels as (select deliverable_id from app.conversation_deliverables(p_context_type, p_context_id)),
  -- A sub_task anchor is about ONE task; every other anchor covers all tasks under its deliverables.
  tasks as (
    select st.* from sub_tasks st
    where st.tenant_id = app.current_tenant_id()
      and (case when p_context_type = 'sub_task'
                then st.id = p_context_id
                else st.deliverable_id in (select deliverable_id from dels) end)
      -- Cancelled work names nobody: its assignee is no longer on it (ADR-0061).
      and st.status <> 'cancelled'
  )
  select t.assignee_id, 'assignee'    from tasks t where t.assignee_id is not null
  union
  -- ADR-0043 dropped sub_tasks.reviewer_id; the join table is the single home and the ONLY place a
  -- reviewer can be found. This row is the whole reason the old gate was unusable.
  select r.user_id,     'reviewer'    from sub_task_reviewers r join tasks t on t.id = r.sub_task_id
  union
  select t.created_by,  'assigner'    from tasks t where t.created_by is not null
  union
  select d.owner_user_id, 'owner'     from deliverables d
    where d.id in (select deliverable_id from dels) and d.owner_user_id is not null
  union
  select c.account_manager_id, 'account_manager' from campaigns c
    where c.id = app.conversation_campaign(p_context_type, p_context_id)
      and c.account_manager_id is not null
$$;
comment on function app.conversation_participants(text, uuid) is
  'ADR-0062 d.2: the people named on the work — assignee, REVIEWER (sub_task_reviewers, ADR-0043), '
  'assigner, deliverable owner, account manager — each with the reason, which ADR-0063 d.8 shows.';

-- ---------------------------------------------------------------- invitations ----

-- Null = the row was written when somebody entitled opened the thread; it is a join record for
-- realtime topic authorisation and the read cursor, and confers nothing (ADR-0062 d.5).
-- Non-null = a decision a person took, and the only kind of row that grants access by itself.
-- Server-stamped, following `user_grants.granted_by` (L6.1).
alter table conversation_members
  add column if not exists added_by uuid references user_profiles(id);
comment on column conversation_members.added_by is
  'ADR-0062 d.6: who invited this member. NULL = joined by derivation (no entitlement of its own); '
  'NOT NULL = an explicit invitation, which IS an entitlement. Never set by a client.';

create index if not exists idx_conversation_members_invited
  on conversation_members (conversation_id) where added_by is not null;

-- Does this anchor exist IN THE CALLER'S TENANT?
--
-- The participant and scope branches below are self-fencing: they only ever read rows whose
-- `tenant_id` is the caller's, so a foreign anchor yields nobody and they refuse. The OVERSIGHT
-- branch is not — `chat_oversight` is a permission the caller holds in their OWN tenant, and it
-- short-circuited before anything asked whose work this was. A Traffic Manager in tenant B could
-- therefore read tenant A's conversations. Caught by `077_conversation_entitlement` test 20, which
-- is exactly what the adversarial suite is for.
create or replace function app.conversation_in_tenant(p_context_type text, p_context_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select case p_context_type
    when 'campaign' then exists (
      select 1 from campaigns c where c.id = p_context_id and c.tenant_id = app.current_tenant_id())
    when 'sub_task' then exists (
      select 1 from sub_tasks st where st.id = p_context_id and st.tenant_id = app.current_tenant_id())
    when 'deliverable' then exists (
      select 1 from deliverables d where d.id = p_context_id and d.tenant_id = app.current_tenant_id())
    when 'review' then exists (
      select 1 from deliverables d where d.id = p_context_id and d.tenant_id = app.current_tenant_id())
    else false
  end
$$;
comment on function app.conversation_in_tenant(text, uuid) is
  'ADR-0062: the tenant fence for chat entitlement. Required BEFORE the chat_oversight branch, '
  'which is otherwise a cross-tenant read (077 test 20).';

-- ---------------------------------------------------------------- the decision ----

-- Is the caller entitled to this conversation?
--
-- Four ways in, in ADR-0062 order: participation (d.2), a lead whose scope covers a participant
-- (d.3), management (d.4), and an explicit invitation (d.6). Recomputed on every call and never
-- cached — membership legitimately changes when work is reassigned or a reviewer is appointed
-- (d.5), so `conversation_members` is a join record and a place to hold invitations, never the
-- authorisation itself.
create or replace function app.can_read_conversation(p_context_type text, p_context_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select
    -- Chat is internal. The portal fence is first because it is absolute (ADR-0062 d.9). It is
    -- `app.is_portal_user`, NOT a scope test: the client_portal role's scope is 'self', the same
    -- value a Team Member carries, so a scope comparison would either admit the portal or lock out
    -- every ordinary member (`20260812100100:102`).
    not app.is_portal_user(auth.uid())
    and p_context_type in ('campaign', 'deliverable', 'sub_task', 'review')
    -- Whose work this is, before anything about who the caller is.
    and app.conversation_in_tenant(p_context_type, p_context_id)
    and (
      -- d.4 — management, fenced to WORK anchors by the clause above. It can never reach a
      -- dm/group conversation, which is what keeps private messaging a free decision.
      app.has_permission('chat_oversight', 'view')
      -- d.2 — named on the work.
      or exists (
        select 1 from app.conversation_participants(p_context_type, p_context_id) p
        where p.user_id = auth.uid()
      )
      -- d.3 — a lead over somebody named on the work. Deliberately the EXISTING primitive: it
      -- already encodes tenant/department/team/account reach, already covers a department's teams,
      -- and already honours the ADR-0036 per-user overlay, so granting a lead a second department
      -- in the Permissions editor extends their chat reach with no code change. The account
      -- manager is passed explicitly — passing null is the documented way to make an 'account'
      -- scope match nothing at all (traps.md).
      or exists (
        select 1
        from app.conversation_participants(p_context_type, p_context_id) p
        join user_profiles u on u.id = p.user_id
        where app.in_write_scope(
                u.department_id, u.team_id,
                (select c.account_manager_id from campaigns c
                  where c.id = app.conversation_campaign(p_context_type, p_context_id)))
      )
      -- d.6 — invited by name. Only a row someone actually decided on: `added_by` null means the
      -- row was written by derivation and carries no entitlement of its own.
      or exists (
        select 1
        from conversation_members m
        join conversations cv on cv.id = m.conversation_id
        where m.user_id = auth.uid()
          and m.added_by is not null
          and cv.tenant_id = app.current_tenant_id()
          and cv.context_type = p_context_type
          and cv.context_id = p_context_id
      )
    )
$$;
comment on function app.can_read_conversation(text, uuid) is
  'ADR-0062: THE chat entitlement. Participation OR a lead in scope OR chat_oversight OR an explicit '
  'invitation. Fenced to work anchors, so oversight never reaches a dm/group conversation.';

-- May the caller add or remove somebody here?
--
-- Everyone with a standing claim on the work: participants, leads in scope, and management — who
-- are full participants, not observers (Edward, 31 Aug). NOT someone who was themselves invited:
-- an invitation cannot fan out, so every membership traces back to a person accountable for the
-- work. That is the single difference from `can_read_conversation`, and it is one clause.
create or replace function app.can_manage_conversation_members(p_context_type text, p_context_id uuid)
returns boolean
language sql stable security definer
set search_path = public, app, extensions as $$
  select
    not app.is_portal_user(auth.uid())
    and p_context_type in ('campaign', 'deliverable', 'sub_task', 'review')
    and app.conversation_in_tenant(p_context_type, p_context_id)
    and (
      app.has_permission('chat_oversight', 'view')
      or exists (
        select 1 from app.conversation_participants(p_context_type, p_context_id) p
        where p.user_id = auth.uid()
      )
      or exists (
        select 1
        from app.conversation_participants(p_context_type, p_context_id) p
        join user_profiles u on u.id = p.user_id
        where app.in_write_scope(
                u.department_id, u.team_id,
                (select c.account_manager_id from campaigns c
                  where c.id = app.conversation_campaign(p_context_type, p_context_id)))
      )
    )
$$;
comment on function app.can_manage_conversation_members(text, uuid) is
  'ADR-0062 d.6: who may invite or remove. can_read_conversation MINUS the invited path — an '
  'invited member may not invite a third, so every membership traces to somebody accountable.';

-- ---------------------------------------------------------------- the orphan ----

-- I32.5 / ADR-0063 d.6. `conversations.context_id` is a bare uuid with no foreign key, so deleting
-- the thing a thread is about leaves the thread behind, unreachable and permanent. One such row is
-- live right now: a `deliverable` conversation created 29 Aug whose deliverable was deleted the
-- same day. There is no FK to add — `context_id` points at four different tables by `context_type`
-- — so the cascade is a trigger on each anchor, and the existing orphans are swept once here.
create or replace function app.tg_delete_orphaned_conversations()
returns trigger language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  delete from conversations
   where context_type = tg_argv[0]
     and context_id = old.id;
  return old;
end $$;
comment on function app.tg_delete_orphaned_conversations() is
  'ADR-0063 d.6: a conversation does not outlive its anchor. context_id has no FK (it points at '
  'four tables), so the cascade is a trigger per anchor table.';

drop trigger if exists conversations_follow_deliverable on deliverables;
create trigger conversations_follow_deliverable after delete on deliverables
  for each row execute function app.tg_delete_orphaned_conversations('deliverable');

drop trigger if exists conversations_follow_sub_task on sub_tasks;
create trigger conversations_follow_sub_task after delete on sub_tasks
  for each row execute function app.tg_delete_orphaned_conversations('sub_task');

drop trigger if exists conversations_follow_campaign on campaigns;
create trigger conversations_follow_campaign after delete on campaigns
  for each row execute function app.tg_delete_orphaned_conversations('campaign');

-- Sweep what is already stranded. Messages and members cascade from `conversations` already.
delete from conversations c
 where c.context_id is not null
   and c.context_type in ('campaign', 'deliverable', 'sub_task', 'review')
   and not exists (
     select 1 from deliverables d where d.id = c.context_id and c.context_type in ('deliverable', 'review')
     union all
     select 1 from sub_tasks  s where s.id = c.context_id and c.context_type = 'sub_task'
     union all
     select 1 from campaigns  m where m.id = c.context_id and c.context_type = 'campaign'
   );

-- ---------------------------------------------------------------- doorways ----

-- PostgREST-visible, exactly as `public.has_permission` (ADR-0037, `20260824100000`) is: `app` is
-- not exposed, so this is how the Edge Function reaches the primitive instead of re-deciding.
create or replace function public.can_read_conversation(p_context_type text, p_context_id uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select app.can_read_conversation(p_context_type, p_context_id)
$$;

create or replace function public.can_manage_conversation_members(p_context_type text, p_context_id uuid)
returns boolean language sql stable
set search_path = public, app, extensions as $$
  select app.can_manage_conversation_members(p_context_type, p_context_id)
$$;

-- The member list ADR-0063 d.8 renders. Entitlement-gated by its own first clause: you may not
-- enumerate the people on a conversation you cannot read.
create or replace function public.conversation_people(p_context_type text, p_context_id uuid)
returns table (user_id uuid, display_name text, reason text)
language sql stable
set search_path = public, app, extensions as $$
  -- The name is joined here rather than resolved by the client: `user_profiles` is tenant-readable
  -- to any authenticated user (`20260728110100:76`), so an INVOKER function reaches it under the
  -- caller's own RLS and no privilege is widened to render a member list.
  select p.user_id, u.display_name, p.reason
  from app.conversation_participants(p_context_type, p_context_id) p
  join user_profiles u on u.id = p.user_id
  where app.can_read_conversation(p_context_type, p_context_id)
  union
  select m.user_id, u.display_name, 'invited'
  from conversation_members m
  join conversations cv on cv.id = m.conversation_id
  join user_profiles u on u.id = m.user_id
  where m.added_by is not null
    and cv.tenant_id = app.current_tenant_id()
    and cv.context_type = p_context_type
    and cv.context_id = p_context_id
    and app.can_read_conversation(p_context_type, p_context_id)
$$;
comment on function public.conversation_people(text, uuid) is
  'ADR-0063 d.8: who is in this conversation and WHY, for the member list. Refuses to enumerate a '
  'conversation the caller may not read.';

revoke execute on function public.can_read_conversation(text, uuid) from public, anon;
revoke execute on function public.can_manage_conversation_members(text, uuid) from public, anon;
revoke execute on function public.conversation_people(text, uuid) from public, anon;
grant execute on function public.can_read_conversation(text, uuid) to authenticated, service_role;
grant execute on function public.can_manage_conversation_members(text, uuid) to authenticated, service_role;
grant execute on function public.conversation_people(text, uuid) to authenticated, service_role;

commit;
