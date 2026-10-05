-- ADR-0038 pre-flight: who reviews each task, and would the NOT NULL constraint hold?
--
-- Run in the Supabase SQL editor (as postgres — RLS is bypassed, so this sees every row).
-- Read-only: no writes, no locks.
--
-- The reviewer lives on the DELIVERABLE today (deliverables.reviewer_id, ADR-0035); ADR-0038 moves
-- the requirement onto the TASK. So each task's reviewer is the one it would inherit. Two ways a
-- task can fail: its deliverable names no reviewer, or it is a standalone task (ADR-0034) with no
-- deliverable to inherit from at all.
--
-- The `reviewer_qualified` column matters as much as the name: while TMP.2 was live (20–23 Aug) the
-- reviewer picker listed EVERY internal user, so a task can name someone who cannot actually
-- moderate reviews. Those reviewers can neither approve nor send back — they are stuck, and the task
-- is stuck with them. app.user_holds_permission is the same check the system itself uses
-- (role grant OR per-user allow, minus per-user deny).

-- ---------------------------------------------------------------- 1. every task ----
select
  case
    when st.deliverable_id is null then 'standalone (no deliverable)'
    when d.stream_id is null       then 'ad-hoc'
    else 'campaign'
  end                                                        as kind,
  st.status,
  st.title                                                   as task,
  coalesce(asg.display_name, '— unassigned —')               as assignee,
  coalesce(rev.display_name, '*** NONE ***')                 as reviewer,
  case
    when d.reviewer_id is null then false
    else app.user_holds_permission(d.reviewer_id, 'reviews', 'moderate')
  end                                                        as reviewer_qualified,
  case
    when st.deliverable_id is null then 'BLOCKS: standalone task, nothing to inherit'
    when d.reviewer_id is null     then 'BLOCKS: deliverable has no reviewer'
    when not app.user_holds_permission(d.reviewer_id, 'reviews', 'moderate')
                                   then 'STUCK: reviewer cannot moderate reviews'
    else 'ok'
  end                                                        as verdict,
  d.name                                                     as deliverable,
  st.created_at::date                                        as created,
  st.id                                                      as sub_task_id
from sub_tasks st
left join deliverables  d   on d.id   = st.deliverable_id
left join user_profiles asg on asg.id = st.assignee_id
left join user_profiles rev on rev.id = d.reviewer_id
where st.status <> 'cancelled'
order by
  (case
     when st.deliverable_id is null then 0
     when d.reviewer_id is null     then 0
     when not app.user_holds_permission(d.reviewer_id, 'reviews', 'moderate') then 1
     else 2
   end),
  st.created_at;

-- ------------------------------------------------------------------ 2. summary ----
select
  count(*)                                                                   as open_tasks,
  count(*) filter (where st.deliverable_id is null)                          as standalone_no_deliverable,
  count(*) filter (where st.deliverable_id is not null and d.reviewer_id is null)
                                                                             as deliverable_without_reviewer,
  count(*) filter (where d.reviewer_id is not null
                     and not app.user_holds_permission(d.reviewer_id, 'reviews', 'moderate'))
                                                                             as reviewer_not_qualified,
  count(*) filter (where d.reviewer_id is not null
                     and app.user_holds_permission(d.reviewer_id, 'reviews', 'moderate'))
                                                                             as ready_for_not_null
from sub_tasks st
left join deliverables d on d.id = st.deliverable_id
where st.status <> 'cancelled';
