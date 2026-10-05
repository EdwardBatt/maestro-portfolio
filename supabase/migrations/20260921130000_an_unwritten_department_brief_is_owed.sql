-- I53.22 — An unwritten department brief is owed on My Work (Edward, 21 Sep).
--
-- `my_pending_approvals()` listed a department brief only once a `campaign_briefs` row existed and
-- was unapproved — "delivered by the campaign's approval and not yet accepted". So after a campaign
-- was approved, the department whose brief had not yet been GENERATED saw nothing on *Waiting for
-- you*; only the mail ("Approved: … You need to review the brief and tasks") said anything, and
-- it spoke of a brief that did not exist yet. The inspection walk of 21 Sep: the Content lead saw
-- a row on Northwind (its brief written by the seed), the Creative leads none on LUMA Season 2.
--
-- Edward: *"The owner must be notified, the pending should also appear with correct link on their
-- my-work page as a pending action. 'Waiting for you' gains a row: 'Write Creative's brief for
-- LUMA Season 2', which opens the department tab with the Generate button."*
--
-- A new kind, `department_brief_unwritten`: an approved campaign that gives MY department work
-- and has no written brief for it (no row, or the emptied row a promotion leaves —
-- 20260921120000). For the department's people who can WRITE it — `projects:manage`, which is
-- what Generate asks for (G5) — in scope. The written-and-unapproved kind now excludes an emptied
-- row, so the two never both show. The row's id is the campaign; the page opens on the
-- department's tab (`?tab=<department>`). Not for single jobs: their gate is the owner's task list
-- (ADR-0090), and that row already exists.
--
-- Reproduced from 20260920160000 (its only definition); two changes in the first branch, one new
-- branch after it.

begin;

create or replace function public.my_pending_approvals()
returns table (
  kind           text,
  id             uuid,
  -- What the row is called: the campaign for a brief or a campaign approval, the deliverable for a
  -- task list, the task for a request. `campaign_name` is context and is null where it would
  -- repeat the title.
  title          text,
  campaign_id    uuid,
  campaign_name  text,
  department     text,
  since          timestamptz,
  target_id      uuid,
  deliverable_id uuid
)
language sql stable security invoker
set search_path = public, app, extensions as $$
  -- My department's brief, WRITTEN, delivered by the campaign's approval and not yet accepted.
  -- (I53.22: an emptied row — a promoted job's, 20260921120000 — is not written; it is owed below.)
  select 'department_brief', b.id, c.name, c.id, null, dp.name, c.approved_at, b.department_id, null::uuid
    from campaign_briefs b
    join campaigns c    on c.id = b.campaign_id
    join departments dp on dp.id = b.department_id
    join user_profiles me on me.id = auth.uid()
   where b.approved_at is null
     and b."values" <> '{}'::jsonb
     and c.status = 'approved'
     and me.department_id = b.department_id
     and app.has_permission('briefs', 'approve')
     and app.in_write_scope(b.department_id, null, c.account_manager_id)

  union all
  -- I53.22 (Edward, 21 Sep): my department's brief NOT YET WRITTEN on an approved campaign that
  -- gives it work — owed by the department's own people who can write it (projects:manage is
  -- what Generate asks for), in scope. The row is the campaign; the door is the department's tab.
  select 'department_brief_unwritten', c.id, c.name, c.id, null, dp.name, c.approved_at, me.department_id, null::uuid
    from campaigns c
    join user_profiles me on me.id = auth.uid()
    join departments dp on dp.id = me.department_id
   where c.status = 'approved'
     and c.kind = 'campaign'
     and exists (select 1 from deliverables d join streams s on s.id = d.stream_id
                  where s.campaign_id = c.id and d.department_id = me.department_id and d.state <> 'archived')
     and not exists (select 1 from campaign_briefs b
                      where b.campaign_id = c.id and b.department_id = me.department_id and b."values" <> '{}'::jsonb)
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(me.department_id, null, c.account_manager_id)

  union all
  -- The generated task list of a single job's deliverable I own (ADR-0090).
  select 'task_list', d.id, d.name, c.id, c.name, dp.name, c.approved_at, d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.kind = 'single_job'
     and c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and d.owner_user_id = auth.uid()
     and app.may_approve_deliverable_tasks(d)

  union all
  -- A booking on somebody I lead, asked for by somebody outside their reach (ADR-0087).
  select 'booking_request', q.id, q.title, c.id, c.name, dp.name, q.created_at, q.sub_task_id, d.id
    from sub_task_assignment_requests q
    join sub_tasks st   on st.id = q.sub_task_id
    join deliverables d on d.id = st.deliverable_id
    left join streams s      on s.id = d.stream_id
    left join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where q.status = 'pending'
     and q.requested_by <> auth.uid()
     and auth.uid() in (select a.user_id from public.assignment_request_approvers(q.resource_id) a)
     and app.has_permission('bookings', 'create')
     and app.resource_in_write_scope(q.resource_id)

  union all
  -- A deadline extension asked of ME (ADR-0088).
  select 'extension_request', x.request_id, x.task_title, x.campaign_id, x.campaign_name, dp.name, x.created_at, x.sub_task_id, x.deliverable_id
    from public.sub_task_extension_requests x
    left join departments dp on dp.id = x.department_id
   where x.event_type = 'extension_requested'
     and x.is_pending
     and x.approver_id = auth.uid()
     and x.viewer_can_decide
     and x.actor_id <> auth.uid()

  union all
  -- A campaign or job waiting for ME, its account manager (ADR-0048 d.9).
  select 'campaign', c.id, c.name, c.id, null, null, c.created_at, c.id, null::uuid
    from campaigns c
   where c.status = 'pending_approval'
     and c.account_manager_id = auth.uid()
     and app.has_permission('projects', 'manage')
     and app.in_write_scope(null, null, c.account_manager_id)

  order by 7 asc nulls last;
$$;

comment on function public.my_pending_approvals() is
  'I53.16: every approval the CALLER OWES — as the person the system names for it, never as a '
  'failsafe who merely could (ADR-0070 d.6: a capability, not a queue). Department briefs for '
  'the department''s own people — I53.22: an UNWRITTEN one too, for those who can write it — task lists for the owner, booking requests for the lead named '
  'by assignment_request_approvers, extensions for sub_task_extension_approver, campaigns for '
  'their account manager. Each row also passes the door''s own predicate. Security invoker. '
  'Task reviews are not here: Awaiting my review already lists them.';

revoke execute on function public.my_pending_approvals() from public;
revoke execute on function public.my_pending_approvals() from anon;
grant  execute on function public.my_pending_approvals() to authenticated;

commit;
