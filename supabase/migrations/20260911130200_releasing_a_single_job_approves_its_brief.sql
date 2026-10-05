-- I44 (ADR-0085 d.2, ADR-0084 d.4) — releasing a single job approves its brief in the same press.
--
-- ONE PRESS, THREE THINGS. ADR-0085 d.2: Approve on SJ-04 makes the job `approved`, stamps its
-- brief approved, and releases the deliverable to its owner — "as one act". The first and third
-- already happen in `app.approve_campaign`; the second did not, and it cannot be a separate call
-- from the browser: `approve_department_brief` tests `in_write_scope(department, null, null)`, which
-- an account-scoped Account Manager does not pass. ADR-0084 d.4 is explicit that there is no second
-- gate — "the approved_at/approved_by columns are stamped by the release" — so the release stamps
-- them.
--
-- SINGLE JOBS ONLY. For a campaign the department briefs are generated after approval (ADR-0072)
-- and approved by the department (ADR-0070); the `brief_awaiting_approval` notice below is what
-- tells its leads so. A single job's brief is approved with the job by the AM (ADR-0084 d.2/d.4),
-- and stamping it BEFORE the notification select is what keeps that notice from being sent — a
-- lead told "your brief is waiting for your approval" about a brief they will never approve is
-- exactly the noise ADR-0045 refuses. They receive `campaign_approved` instead, as the deliverable
-- owner, which is the release notice ADR-0085 d.4 promises them. (d.4 names the `assigned` type;
-- `campaign_approved` already reaches the owner here and a second row about the same press would
-- be two notifications for one event — so no second type is sent. Reported in the build notes.)
--
-- Reproduced WHOLE from `20260905190200`, the house pattern: a bare `create or replace` resets
-- `proconfig` and silently drops the ADR-0033 `search_path` pin. The ONLY edit is the stamping
-- block between the status update and the first notification; everything else is byte-identical,
-- deliberately.

begin;

create or replace function app.approve_campaign(p_campaign uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v campaigns; v_am uuid;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if v.id is null then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    raise exception 'this campaign is already approved' using errcode = '22023';
  end if;

  -- Still resolved, still recorded, no longer the gate. `coalesce(campaign, client)` because null on
  -- the campaign means "ask the client" (20260829150000), not "nobody".
  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  -- ADR-0073 d.1/d.4: hold the grant AND be in scope. `in_write_scope`'s account branch takes the
  -- responsible manager, so the assigned AM passes as they always did; everyone else passes or
  -- fails on their own scope, and no role is named here.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    raise exception 'you cannot approve this campaign'
      using errcode = '42501';
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- ADR-0084 d.4 / ADR-0085 d.2: a SINGLE JOB's brief is approved with the job, by the person
  -- pressing Approve. Before the notification below, so no lead is asked to approve it. A campaign's
  -- briefs are untouched — its departments approve their own (ADR-0070).
  if v.kind = 'single_job' then
    update campaign_briefs
       set approved_at = now(), approved_by = auth.uid()
     where campaign_id = p_campaign
       and approved_at is null;
  end if;

  -- ADR-0070 d.6. FIRST, because the generic notice below excludes whoever gets this one.
  --
  -- To the people whose department it is: its leads, its team leads, and a deputy standing in for
  -- one. Scope is what makes them the right recipients, and it is the same set `briefs:approve`
  -- was seeded to minus the agency-wide roles — deliberately, since those can approve anything and
  -- would otherwise receive every brief in the agency. The Account Director (ADR-0073 d.6) is one
  -- of them and is excluded here for the same reason: that is what makes its approval a fallback
  -- rather than a queue.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, up.id, 'brief_awaiting_approval', v.name, 'campaign', v.id, auth.uid()
    from campaign_briefs b
    join user_profiles up on up.department_id = b.department_id
    join roles r on r.id = up.role_id
   where b.campaign_id = p_campaign
     and b.approved_at is null
     and up.tenant_id = v.tenant_id
     and up.is_active
     and r.key in ('department_lead', 'team_lead', 'deputy_team_lead')
     and up.id is distinct from auth.uid();

  -- d.10 of ADR-0048, corrected. Three groups, unioned and de-duplicated, and the actor is never
  -- told about their own approval.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, x.user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid()
  from (
    -- 1. THE DELIVERABLE OWNERS. The person accountable for the thing (ADR-0050).
    select d.owner_user_id as user_id
      from deliverables d
      join streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign and d.owner_user_id is not null

    union

    -- 2. THE DEPARTMENT LEADS of every department with work on this campaign. They have to find
    --    somebody to do it, and until they do, nothing moves. The department comes from the
    --    DELIVERABLE, which ADR-0050 stamps from its owner.
    select up.id
      from deliverables d
      join streams s on s.id = d.stream_id
      join user_profiles up on up.department_id = d.department_id
      join roles r on r.id = up.role_id
     where s.campaign_id = p_campaign
       and d.department_id is not null
       and r.key = 'department_lead'
       and up.tenant_id = v.tenant_id
       and up.is_active

    union

    -- 3. Appointed reviewers. Usually empty at approval — the tasks were materialised moments ago —
    --    but a campaign re-approved after work was appointed should still tell them.
    select rv.user_id
      from sub_task_reviewers rv
      join sub_tasks t on t.id = rv.sub_task_id
      join deliverables d on d.id = t.deliverable_id
      join streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign
  ) x
  where x.user_id is not null
    and x.user_id is distinct from auth.uid()
    -- ADR-0070 d.6: whoever just received the specific "your brief is waiting" message does not
    -- also get the generic one. Two notifications about one event is the noise ADR-0045 refuses.
    and not exists (
      select 1 from notifications n
       where n.entity_id = v.id
         and n.type = 'brief_awaiting_approval'
         and n.user_id = x.user_id
    );
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.8/d.9 as amended by ADR-0073 d.4 (I40): approving requires projects:manage AND '
  'app.in_write_scope over the campaign''s responsible account manager — not a uid comparison. '
  'ADR-0085 d.2 / ADR-0084 d.4: on a SINGLE JOB the same press stamps the job''s brief approved, '
  'so no lead is asked to approve a brief the account manager wrote. No role is named in this '
  'function, deliberately.';

commit;
