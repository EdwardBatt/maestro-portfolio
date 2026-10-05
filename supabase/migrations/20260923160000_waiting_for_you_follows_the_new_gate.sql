-- "Waiting for you" follows the gate: department briefs leave it, task lists arrive (ADR-0100 d.4).
--
-- The list asked two things that no longer exist — *"write Creative's brief for LUMA Season 2"* and
-- *"approve Content's brief"* — and asked the task-list question only of single jobs. ADR-0100 d.2
-- moved the second gate to the owner's task-list approval for ALL work, so this follows it.
--
-- Reproduced whole from `20260921130000` and the I54.25 pricing work; only the branches change.

begin;

CREATE OR REPLACE FUNCTION public.my_pending_approvals()
 RETURNS TABLE(kind text, id uuid, title text, campaign_id uuid, campaign_name text, department text, since timestamp with time zone, target_id uuid, deliverable_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
  -- ADR-0100 d.4: "write your department's brief" and "approve your department's brief" are GONE.
  -- The document they asked for no longer exists, so neither does the ask. (Removing them also
  -- takes out the branch I54.25 found scanning every task in the tenant — a side effect, not a
  -- reason.)
  -- A task list I own and have not accepted yet (ADR-0090; every campaign since ADR-0100 d.2).
  select 'task_list', d.id, d.name, c.id, c.name, dp.name, c.approved_at, d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
   where c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and d.owner_user_id = auth.uid()
     -- ADR-0100 d.7: a campaign approved before the cutover never asked its owners, so it is not
     -- owed now. Without this, switching the gate on would put 115 rows on people's lists at once.
     and (c.kind = 'single_job'
          or c.approved_at >= (select value::timestamptz from app_settings
                                where key = 'task_list_gate_from'))
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
     and app.resource_in_scheduling_scope(q.resource_id)

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
$function$;

commit;
