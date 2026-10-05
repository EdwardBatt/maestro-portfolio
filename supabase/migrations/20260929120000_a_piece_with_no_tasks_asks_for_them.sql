-- I66.3 (Edward, 29 Sep) — a deliverable with no tasks has no task list to approve.
--
-- A piece made with no deliverable type has no workflow, so no task is generated (ADR-0051 d.7 allows it;
-- the single-job form says the lead breaks the work down by hand). Its owner was asked to "approve the task
-- list" — a list with nothing in it — and the Creative lead's My Work counted 23 of them locally beside the
-- dashboard's and the campaigns list's 31. Edward: "how can you include them in the count when there is
-- nothing to count?" — and the owner "should still see their notification … if no tasks have been created,
-- then you need to define the tasks."
--
-- A piece with no LIVE task (none that is not done or cancelled — the campaigns list badge's rule,
-- `awaitsTaskListApproval`):
--   1) `public.my_pending_approvals` gives it as `task_list_undefined`, not `task_list` — same people, same
--      clock. The "Task lists not approved" figures count `task_list` only.
--   2) `app.approve_campaign` marks each such piece `no_tasks` in the owner's `campaign_approved` detail,
--      and counts them (`no_tasks_count`).
--   3) `public.add_campaign_deliverable` and 4) `app.tg_deliverable_owner_notify` record `no_tasks` on the
--      owner's `deliverable_added` / `deliverable_reassigned`.
-- The words ("define the tasks") are the mail's and the inbox's, from that one fact.
--
-- No schema change. Each function reproduced WHOLE from its last definition (grep confirmed):
--   my_pending_approvals       20260927200000
--   approve_campaign           20260926123000
--   add_campaign_deliverable   20260927160000
--   tg_deliverable_owner_notify 20260925120000

begin;

-- ============================================================================
-- 1) the card
-- ============================================================================
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
  -- A task list waiting for approval (ADR-0090; every campaign since ADR-0100 d.2) — on the owner's list,
  -- and (ADR-0119 d.2) on the department lead's and every team lead's of the deliverable's department,
  -- where they may approve it. Every campaign, however old (d.1). `since` is when its clock started —
  -- the one the escalation reads (d.3), so the card and the sweep agree.
  -- I66.3 (Edward, 29 Sep): a piece with no live task has no list to approve — "there is nothing to count" —
  -- but its owner still owes something: the tasks. Same people, same clock, its own kind, so the card says
  -- "define the tasks" and the "Task lists not approved" figures leave it out.
  select case when not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))
              then 'task_list_undefined' else 'task_list' end,
         d.id, d.name, c.id, c.name, dp.name, app.task_list_waiting_since(c.kind, c.approved_at), d.id, d.id
    from deliverables d
    join streams s      on s.id = d.stream_id
    join campaigns c    on c.id = s.campaign_id
    left join departments dp on dp.id = d.department_id
    left join user_profiles own on own.id = d.owner_user_id
   where c.status = 'approved'
     and d.tasks_approved_at is null
     and d.state <> 'archived'
     and (d.owner_user_id = auth.uid()
          or app.leads_department(coalesce(d.department_id, own.department_id)))
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

-- ============================================================================
-- 2) the release notice
-- ============================================================================
create or replace function app.approve_campaign(p_campaign uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public, app, extensions
as $$
declare v campaigns; v_am uuid; v_am_name text; v_fill record;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'this campaign is already approved' using errcode = '22023';
  end if;

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    -- ADR-0083 addendum d.15: say WHO can, not just that the caller cannot. The name rides in
    -- DETAIL so the screen can put it in a sentence; an unset manager is said as such.
    select up.display_name into v_am_name from user_profiles up where up.id = v_am;
    raise exception 'you cannot approve this campaign'
      using errcode = '42501',
            detail = coalesce(v_am_name, ''),
            hint = case when v_am is null then 'no_account_manager' else 'account_manager' end;
  end if;

  -- ---- ADR-0111 (I59.27): nothing fake. A required brief field holding only filler is refused,
  -- the field and its text named. DETAIL carries both as JSON so the screen can say it in Arabic.
  select * into v_fill from app.campaign_brief_filler(p_campaign);
  if v_fill.field_key is not null then
    raise exception '% still says ''%'' — write the real %.',
            v_fill.field_label, v_fill.field_text,
            lower(regexp_replace(v_fill.field_label, '^the\s+', '', 'i'))
      using errcode = '22023',
            detail = jsonb_build_object('field', v_fill.field_key, 'label', v_fill.field_label,
                                        'text', v_fill.field_text)::text,
            hint = 'brief_filler';
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- ADR-0084 d.4 / ADR-0085 d.2: a SINGLE JOB's brief is approved with the job.
  if v.kind = 'single_job' then
    update campaign_briefs
       set approved_at = now(), approved_by = auth.uid()
     where campaign_id = p_campaign
       and approved_at is null;
  end if;

  -- I52 Action 1 (Edward, 17 Sep): the deliverable's OWNER, and nobody else — not department leads
  -- by role, not reviewers. I53.19 (Edward, 21 Sep): ONE row per owner, on the campaign, carrying
  -- how many deliverables are theirs and which — each with its phase and its due date, so the mail
  -- lists them ("Teaser — Phase 1: Pre-Launch, due Saturday 26 September") and says what is
  -- required. Never the approver.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v.tenant_id, d.owner_user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid(),
         jsonb_build_object(
           'deliverable_count', count(*),
           'deliverables', jsonb_agg(jsonb_build_object(
             'name', d.name, 'due_at', d.due_at,
             'phase_number', p.number, 'phase_name', p.name,
             -- I66.3: a piece with no tasks is said as "define the tasks", not "approve the list".
             'no_tasks', not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))) order by d.created_at),
           'no_tasks_count', count(*) filter (where not exists (select 1 from sub_tasks st where st.deliverable_id = d.id and st.status not in ('done', 'cancelled'))),
           'due_at', min(d.due_at))
    from deliverables d
    join streams s on s.id = d.stream_id
    left join campaign_phases p on p.id = d.phase_id
   where s.campaign_id = p_campaign
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid()
   group by d.owner_user_id;
end $$;

-- ============================================================================
-- 3) a piece added to a released campaign
-- ============================================================================
create or replace function public.add_campaign_deliverable(
  p_campaign uuid, p_name text, p_owner uuid, p_type uuid default null, p_quantity integer default 1,
  p_due_at timestamptz default null, p_due_override jsonb default null, p_phase uuid default null,
  p_workstream uuid default null)
returns uuid
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v        campaigns;
  v_stream uuid;
  v_id     uuid;
  v_phase_end date;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = v_tenant;
  if v.id is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  if v.status = 'closed' then
    raise exception 'this campaign is closed — reopen it before adding to it' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(p_campaign) then
    raise exception
      'adding a deliverable to this campaign is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'a deliverable needs a name' using errcode = '22023';
  end if;
  if p_owner is null or not exists (select 1 from user_profiles up where up.id = p_owner and up.tenant_id = v_tenant) then
    raise exception 'a deliverable needs an owner' using errcode = '22023';
  end if;
  if p_type is not null and not exists (
       select 1 from deliverable_types dt where dt.id = p_type and dt.tenant_id = v_tenant) then
    raise exception 'that deliverable type is not in your organization' using errcode = '22023';
  end if;
  if p_due_at is null then
    raise exception 'a deliverable needs a due date' using errcode = '22023';
  end if;
  if v.has_phases and p_phase is null then
    raise exception 'this campaign runs in phases — choose the phase' using errcode = '22023';
  end if;
  -- ADR-0116 d.3: a campaign's piece names its workstream, one of this campaign's.
  if v.kind = 'campaign' then
    if p_workstream is null then
      raise exception 'Every piece of a campaign goes in a workstream: choose one for "%".', trim(p_name)
        using errcode = '22023', hint = 'piece_needs_workstream';
    end if;
    if not exists (select 1 from workstreams w where w.id = p_workstream and w.campaign_id = p_campaign) then
      raise exception 'that workstream is not on this campaign' using errcode = '22023';
    end if;
  end if;

  select s.id into v_stream from streams s where s.campaign_id = p_campaign order by s.created_at limit 1;
  if v_stream is null then
    insert into streams (tenant_id, campaign_id, name) values (v_tenant, p_campaign, v.name)
    returning id into v_stream;
  end if;

  insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id, deliverable_type_id, quantity, phase_id, workstream_id)
  values (v_tenant, v_stream, trim(p_name), 'draft', p_due_at, p_owner, p_type, greatest(coalesce(p_quantity, 1), 1),
          case when v.has_phases then p_phase end,
          case when v.kind = 'campaign' then p_workstream end)
  returning id into v_id;

  if p_due_override is not null and jsonb_typeof(p_due_override) = 'object' then
    select p.ends_on into v_phase_end from campaign_phases p where p.id = p_phase;
    perform app.record_due_date_override(
      v_id,
      (p_due_at at time zone 'Asia/Baghdad')::date,
      p_due_override ->> 'severity',
      (v.go_live_at at time zone 'UTC')::date,
      coalesce((p_due_override ->> 'workingDaysLeft')::int, 0),
      coalesce((p_due_override ->> 'requiredDays')::int, 0),
      nullif(p_due_override ->> 'outstandingHours', '')::numeric,
      nullif(p_due_override ->> 'capacityHours', '')::numeric,
      coalesce(p_due_override ->> 'boundary', 'go_live'),
      case when coalesce(p_due_override ->> 'boundary', 'go_live') = 'phase_end' then v_phase_end end);
  end if;

  -- I53.18 (Edward, 21 Sep): on a RELEASED campaign, the new deliverable's owner is told — and only
  -- them. The words are Action 15's for_owner sentence; the button opens the deliverable.
  if v.status = 'approved' and p_owner is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (v_tenant, p_owner, 'deliverable_added', trim(p_name), 'deliverable', v_id, auth.uid(),
            jsonb_build_object('for_owner', true, 'due_at', p_due_at,
              -- I66.3: no type, no workflow — no tasks were made, and the owner is told to define them.
              'no_tasks', not exists (select 1 from sub_tasks st where st.deliverable_id = v_id
                                                                   and st.status not in ('done', 'cancelled'))));
  end if;
  return v_id;
end $$;

comment on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) is
  'I52.20 with ADR-0096 d.8 and ADR-0093 addendum d.7: add a deliverable to an existing campaign '
  'or job, under the approval authority. A due date is required; p_phase is required when the '
  'campaign runs in phases. I53.18: on a released campaign the new owner is told (deliverable_added, '
  'for_owner) and nobody else. ADR-0116 d.3: a campaign''s piece names p_workstream (one of its own).';

revoke execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) from public, anon;
grant  execute on function public.add_campaign_deliverable(uuid, text, uuid, uuid, integer, timestamptz, jsonb, uuid, uuid) to authenticated;

-- ============================================================================
-- 4) a new owner
-- ============================================================================

CREATE OR REPLACE FUNCTION app.tg_deliverable_owner_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
begin
  if new.owner_user_id is not distinct from old.owner_user_id then
    return null;
  end if;

  -- Nobody to tell when a migration or seeder moves it, and no actor to attribute it to.
  if auth.uid() is null or app.is_system_op() then
    return null;
  end if;

  -- I52 Action 2 (Edward, 17 Sep). The NEW owner is told what is now theirs — and, since I57.44,
  -- whether its task list still waits for them; the OLD owner is told, in one line, who has it now.
  -- Never the person who made the change.
  if new.owner_user_id is not null and new.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    values (new.tenant_id, new.owner_user_id, 'deliverable_reassigned', new.name, 'deliverable', new.id, auth.uid(),
            jsonb_build_object('tasks_approved', app.deliverable_work_acceptance_refusal(new.id) is null,
              -- I66.3: a piece with no live task — the new owner defines the tasks first.
              'no_tasks', not exists (select 1 from sub_tasks st where st.deliverable_id = new.id
                                                                   and st.status not in ('done', 'cancelled'))));
  end if;
  if old.owner_user_id is not null and old.owner_user_id is distinct from auth.uid() then
    insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
    select new.tenant_id, old.owner_user_id, 'deliverable_owner_removed', new.name, 'deliverable', new.id, auth.uid(),
           jsonb_build_object('new_owner', up.display_name)
      from (select 1) x
      left join user_profiles up on up.id = new.owner_user_id;
  end if;

  return null;
end $function$;

commit;
