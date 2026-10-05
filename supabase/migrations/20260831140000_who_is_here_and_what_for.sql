-- I32.3 (ADR-0063 d.8) — the member list says what each person is here FOR, by name.
--
-- Edward, 31 Aug, on the campaign room: "the header shows owners of everything… but is ambiguous.
-- There is 3 — owns deliverable, one assigned it and one account manager. This needs to be
-- specified, e.g. X owns <name of deliverable>."
--
-- He is right, and it is worst exactly where the list is most useful. A campaign room spans every
-- deliverable beneath it, so "owner" appears once per deliverable and "assignee" once per task:
-- three bare labels reading `owner`, `assigner`, `account_manager` tell you the SHAPE of somebody's
-- involvement and nothing about WHICH work. On a campaign with 40 tasks that is unreadable.
--
-- So a reason now carries its SUBJECT: the task for an assignee/reviewer/assigner, the deliverable
-- for an owner, the campaign for an account manager, and the INVITER for somebody added by name —
-- because "added" is not a fact about the work, it is a fact about a decision somebody took.
--
-- Aggregated to one row per (person, reason) with the subjects as an array, so a person on eleven
-- tasks is one line saying so rather than eleven lines. The surface renders the single case by name
-- ("owns Hero KV") and the plural by count ("reviewing 4 tasks").
--
-- Replaces the two-column version from `20260831120100`; the signature changes, so it is dropped
-- first. Nothing else calls it — `_shared/context-members.ts` and the chat panel move with it.

begin;

drop function if exists public.conversation_people(text, uuid);

create or replace function public.conversation_people(p_context_type text, p_context_id uuid)
returns table (user_id uuid, display_name text, reason text, subjects text[])
language sql stable
set search_path = public, app, extensions as $$
  with allowed as (select app.can_read_conversation(p_context_type, p_context_id) as ok),
  dels as (select deliverable_id from app.conversation_deliverables(p_context_type, p_context_id)),
  tasks as (
    select st.* from sub_tasks st
    where st.tenant_id = app.current_tenant_id()
      and (case when p_context_type = 'sub_task'
                then st.id = p_context_id
                else st.deliverable_id in (select deliverable_id from dels) end)
      and st.status <> 'cancelled'
  ),
  raw as (
    -- The subject is the TASK for the three task-shaped reasons: that is the thing a person is on.
    select t.assignee_id as uid, 'assignee'::text as reason, t.title as subject
      from tasks t where t.assignee_id is not null
    union all
    select r.user_id, 'reviewer', t.title
      from sub_task_reviewers r join tasks t on t.id = r.sub_task_id
    union all
    select t.created_by, 'assigner', t.title
      from tasks t where t.created_by is not null
    union all
    -- The DELIVERABLE for an owner (ADR-0050) — ownership is of the artefact, not of a task.
    select d.owner_user_id, 'owner', d.name
      from deliverables d
      where d.id in (select deliverable_id from dels) and d.owner_user_id is not null
    union all
    select c.account_manager_id, 'account_manager', c.name
      from campaigns c
      where c.id = app.conversation_campaign(p_context_type, p_context_id)
        and c.account_manager_id is not null
    union all
    -- For an invitation the useful subject is WHO ASKED, not what the work is: that is the whole
    -- content of the fact, and it is the one membership a person took a decision to create.
    select m.user_id, 'invited', inviter.display_name
      from conversation_members m
      join conversations cv on cv.id = m.conversation_id
      left join user_profiles inviter on inviter.id = m.added_by
      where m.added_by is not null
        and cv.tenant_id = app.current_tenant_id()
        and cv.context_type = p_context_type
        and cv.context_id = p_context_id
  )
  select raw.uid, u.display_name, raw.reason,
         array_agg(distinct raw.subject) filter (where raw.subject is not null)
  from raw
  join user_profiles u on u.id = raw.uid
  cross join allowed
  where allowed.ok
  group by raw.uid, u.display_name, raw.reason
$$;

comment on function public.conversation_people(text, uuid) is
  'ADR-0063 d.8: who is in this conversation, why, and WHAT FOR — the task, deliverable, campaign '
  'or inviter each reason is about. One row per (person, reason); a bare label was ambiguous on a '
  'campaign room, which spans every deliverable beneath it. Refuses to enumerate a conversation the '
  'caller may not read.';

revoke execute on function public.conversation_people(text, uuid) from public, anon;
grant execute on function public.conversation_people(text, uuid) to authenticated, service_role;

commit;
