-- I48 (Edward, 13 Sep) — on the campaign list, a single job is not "done" until its task list is.
--
-- The list reads `department_brief_approved` from `campaign_briefs.approved_at`. For a SINGLE JOB
-- that is stamped at release (ADR-0084 d.4), so the list showed the brief "approved" while the
-- owner had not yet approved the TASK LIST (ADR-0090). Edward: *"the dept brief is only considered
-- approved once the task list is approved."* The campaign flow is unchanged — a campaign deliverable
-- has no task-list gate (ADR-0090 d.6) — so the list display for single jobs is what moves, and it
-- needs the task-list-approval counts the view does not yet carry.
--
-- Reproduced from `20260911130000` (the last definition of campaign_list_rows — grep confirmed),
-- VERBATIM, with ONE added lateral join exposing, per campaign, how many of its deliverables have an
-- approved task list. The frontend uses it for single jobs.

begin;

create or replace view campaign_list_rows
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.name,
  c.status,
  c.go_live_at,
  cl.name                as client_name,
  b.name                 as brand_name,
  am.display_name        as account_manager_name,
  coalesce(db.total, 0)    as department_brief_total,
  coalesce(db.approved, 0) as department_brief_approved,
  coalesce(ow.owners, array[]::text[]) as brief_owner_names,
  c.kind,
  -- Appended AFTER the existing columns: `create or replace view` can only add at the end.
  coalesce(tl.total, 0)    as deliverable_total,
  coalesce(tl.approved, 0) as deliverable_tasks_approved
from campaigns c
join clients cl on cl.id = c.client_id
left join brands b on b.id = c.brand_id
left join user_profiles am on am.id = c.account_manager_id
left join lateral (
  select count(*)::int as total,
         count(*) filter (where cb.approved_at is not null)::int as approved
    from campaign_briefs cb
   where cb.campaign_id = c.id
) db on true
left join lateral (
  select array_agg(distinct p.display_name order by p.display_name) as owners
    from streams s
    join deliverables d on d.stream_id = s.id
    join user_profiles p on p.id = d.owner_user_id
   where s.campaign_id = c.id
) ow on true
-- I48: how many of the campaign's deliverables have had their task list approved (ADR-0090). For a
-- single job the list reads this instead of the brief's approved_at to say whether it is done.
left join lateral (
  select count(*)::int as total,
         count(*) filter (where d.tasks_approved_at is not null)::int as approved
    from streams s2
    join deliverables d on d.stream_id = s2.id
   where s2.campaign_id = c.id
) tl on true;

commit;
