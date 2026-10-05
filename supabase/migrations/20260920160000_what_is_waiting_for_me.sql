-- I53.16 — "Waiting for you": every approval the signed-in person OWES, in one list.
--
-- Edward, 20 Sep: *"confirm all pending approvals are displayed in respective individuals my-work
-- page"* — and, told they were not: *"Team Leads and Department Leads still need a my-work page."*
--
-- What existed: task reviews on My Work (Awaiting my review); department briefs and held task
-- lists on the dashboard, behind `health:view`, which no lead holds — so the people who owe those
-- approvals had no list of them; booking requests in the notification inbox only; extension
-- requests on the dashboard; a campaign pending approval on the campaigns list. Five kinds of
-- approval, five places, and the one page a lead can always open showed one of them.
--
-- WHOSE list this is. A first cut listed everything the caller COULD approve — and the Power
-- Admin, who can approve anything, saw every approval in the company. Edward: *"all the pending
-- approvals in the system are being displayed in my-work, even though I am neither the Account
-- Manager or the deliverable owner."* ADR-0070 d.6 had already drawn the line: *"the failsafe is a
-- capability, not a queue."* So each row is for the person the system NAMES as its approver — the
-- one who is notified — and never for the failsafe who merely could:
--
--   department_brief   the department's own people: briefs:approve AND the caller's department
--                      is the brief's (the set `approve_campaign` notifies, ADR-0070 d.6)
--   task_list          the deliverable's OWNER (ADR-0090 d.4; never the AM, 12 Sep addendum)
--   booking_request    a lead `assignment_request_approvers` names for the resource — the people
--                      told (ADR-0087 d.6); never the requester
--   extension_request  `app.sub_task_extension_approver` — the account manager, else whoever
--                      assigned the task (ADR-0088 d.3)
--   campaign           the campaign's own account manager (ADR-0048 d.9)
--
-- Each row also re-asks the door's own predicate, so a named approver who has lost the grant is
-- not shown a row the RPC would refuse. Power Admin and Traffic keep the failsafe where it lives:
-- the campaign page's buttons, the dashboard's company-wide panels.
--
-- Security INVOKER: the caller reads only what RLS shows them, and the predicates read the
-- caller's own claims.
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
  -- My department's brief, delivered by the campaign's approval and not yet accepted.
  select 'department_brief', b.id, c.name, c.id, null, dp.name, c.approved_at, b.department_id, null::uuid
    from campaign_briefs b
    join campaigns c    on c.id = b.campaign_id
    join departments dp on dp.id = b.department_id
    join user_profiles me on me.id = auth.uid()
   where b.approved_at is null
     and c.status = 'approved'
     and me.department_id = b.department_id
     and app.has_permission('briefs', 'approve')
     and app.in_write_scope(b.department_id, null, c.account_manager_id)

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
  'the department''s own people, task lists for the owner, booking requests for the lead named '
  'by assignment_request_approvers, extensions for sub_task_extension_approver, campaigns for '
  'their account manager. Each row also passes the door''s own predicate. Security invoker. '
  'Task reviews are not here: Awaiting my review already lists them.';

revoke execute on function public.my_pending_approvals() from public;
revoke execute on function public.my_pending_approvals() from anon;
grant  execute on function public.my_pending_approvals() to authenticated;

commit;
