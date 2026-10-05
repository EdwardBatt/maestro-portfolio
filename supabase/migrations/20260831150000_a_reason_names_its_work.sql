-- I32.3 (ADR-0063 d.8, corrected) — a reason must be true about the work, not merely near it.
--
-- Edward, 31 Aug, on Test Campaign's room: "the very first person name is shown as having been
-- assigned 17 tasks which is not correct. No tasks have actually been assigned except for 2 which
-- were cancelled. It also shows Edward Video owning 2 deliverables… but not named."
--
-- He is right, and the line was wrong in three separate ways at once:
--
--   1. **THE VERB.** The row reads `sub_tasks.created_by` and rendered it as *assigned*. Those are
--      different facts and on this campaign they are opposite ones: 26 live tasks exist, every one
--      of them created by the same person, and **NOT ONE IS ASSIGNED TO ANYBODY**. ADR-0062 d.2
--      itself calls this participant "the assigner (`sub_tasks.created_by`)" — the conflation
--      starts in the decision record, and this migration is where it stops. Creating a task is
--      putting the work on the board (usually by materialising a workflow template, ADR-0052);
--      assigning it is naming a person, which `assignee_id` records and which nobody has done here.
--
--   2. **THE NUMBER.** `array_agg(distinct subject)` collapsed 26 tasks into 17 distinct TITLES,
--      and the surface counted the array. So the figure was neither the number of tasks nor the
--      number of anything a person would recognise. The count is now `count(*)` over the rows, and
--      the array is only ever used for NAMING.
--
--   3. **THE NAMING.** Two deliverables became "owns 2 deliverables" when naming both would have
--      fitted easily. Subjects are capped at three here so a 200-task campaign does not ship 200
--      strings, and the surface names up to three and counts beyond that.
--
-- Forward-only: `20260831140000` is applied, so this replaces it rather than editing it.

begin;

drop function if exists public.conversation_people(text, uuid);

create or replace function public.conversation_people(p_context_type text, p_context_id uuid)
returns table (user_id uuid, display_name text, reason text, subjects text[], total integer)
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
    select t.assignee_id as uid, 'assignee'::text as reason, t.title as subject
      from tasks t where t.assignee_id is not null
    union all
    select r.user_id, 'reviewer', t.title
      from sub_task_reviewers r join tasks t on t.id = r.sub_task_id
    union all
    -- `created_by`, named honestly: this person PUT THE WORK THERE. On a campaign built from a
    -- workflow template that is whoever approved it, and it says nothing about who will do it.
    select t.created_by, 'creator', t.title
      from tasks t where t.created_by is not null
    union all
    select d.owner_user_id, 'owner', d.name
      from deliverables d
      where d.id in (select deliverable_id from dels) and d.owner_user_id is not null
    union all
    select c.account_manager_id, 'account_manager', c.name
      from campaigns c
      where c.id = app.conversation_campaign(p_context_type, p_context_id)
        and c.account_manager_id is not null
    union all
    select m.user_id, 'invited', inviter.display_name
      from conversation_members m
      join conversations cv on cv.id = m.conversation_id
      left join user_profiles inviter on inviter.id = m.added_by
      where m.added_by is not null
        and cv.tenant_id = app.current_tenant_id()
        and cv.context_type = p_context_type
        and cv.context_id = p_context_id
  )
  select
    raw.uid,
    u.display_name,
    raw.reason,
    -- Up to three names, for the surface to read out. Sliced in SQL so a large campaign does not
    -- send hundreds of strings nobody will render.
    (array_agg(distinct raw.subject) filter (where raw.subject is not null))[1:3],
    -- The true count of ROWS — how many tasks, deliverables or campaigns this reason covers. Never
    -- the length of the array above: two tasks can share a title, and 26 shared 17.
    count(*)::integer
  from raw
  join user_profiles u on u.id = raw.uid
  cross join allowed
  where allowed.ok
  group by raw.uid, u.display_name, raw.reason
$$;

comment on function public.conversation_people(text, uuid) is
  'ADR-0063 d.8: who is in this conversation, why, and what for. `total` is the real number of rows '
  'the reason covers; `subjects` is up to three NAMES for the surface to read out — counting the '
  'array reported 17 for 26 tasks. The `creator` reason is sub_tasks.created_by and is deliberately '
  'NOT called "assigned": on a template-built campaign nobody may be assigned at all.';

revoke execute on function public.conversation_people(text, uuid) from public, anon;
grant execute on function public.conversation_people(text, uuid) to authenticated, service_role;

commit;
