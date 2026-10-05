-- I48 (Edward, 13 Sep) — a single job's owner is sent to the deliverable, not the campaign page.
--
-- The owner works a single job on the DELIVERABLE detail (the task list, Approve-task-list, and
-- reassigning to a team lead all live there). Their release notification was `campaign_approved`
-- with a CAMPAIGN entity, so the inbox sent them to /campaigns/:id — an overview that cannot do any
-- of that. For a single job, retarget the OWNER's notification to the deliverable so it deep-links
-- to /deliverables?open=<id>. Campaign behaviour is unchanged, and so is everyone else's
-- notification (dept leads, reviewers) — only the single-job owner's entity moves.
--
-- Reproduced from `20260911130200` (the last definition of app.approve_campaign — grep confirmed),
-- VERBATIM, with ONE added block at the end. The union insert is untouched; a targeted UPDATE after
-- it moves just the owner's row, which is far safer than restructuring the recipient union.

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

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    raise exception 'you cannot approve this campaign'
      using errcode = '42501';
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

  -- ADR-0070 d.6. FIRST, because the generic notice below excludes whoever gets this one.
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

  -- d.10 of ADR-0048, corrected. Three groups, unioned and de-duplicated.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, x.user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid()
  from (
    select d.owner_user_id as user_id
      from deliverables d
      join streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign and d.owner_user_id is not null

    union

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

    select rv.user_id
      from sub_task_reviewers rv
      join sub_tasks t on t.id = rv.sub_task_id
      join deliverables d on d.id = t.deliverable_id
      join streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign
  ) x
  where x.user_id is not null
    and x.user_id is distinct from auth.uid()
    and not exists (
      select 1 from notifications n
       where n.entity_id = v.id
         and n.type = 'brief_awaiting_approval'
         and n.user_id = x.user_id
    );

  -- I48 (13 Sep): for a SINGLE JOB, the owner works on the deliverable, so their notification points
  -- there (the inbox routes a deliverable entity to /deliverables?open=<id>). Only the owner's row
  -- moves; dept leads and reviewers keep the campaign entity. Done as a targeted update so the
  -- recipient union above stays exactly as it was.
  if v.kind = 'single_job' then
    update notifications n
       set entity_type = 'deliverable', entity_id = d.id
      from deliverables d
      join streams s on s.id = d.stream_id
     where s.campaign_id = p_campaign
       and d.owner_user_id is not null
       and n.tenant_id = v.tenant_id
       and n.type = 'campaign_approved'
       and n.entity_type = 'campaign'
       and n.entity_id = p_campaign
       and n.user_id = d.owner_user_id;
  end if;
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.8/d.9 as amended by ADR-0073 d.4 (I40): approving requires projects:manage AND '
  'app.in_write_scope over the campaign''s responsible account manager. ADR-0085 d.2 / ADR-0084 '
  'd.4: on a SINGLE JOB the same press stamps the job''s brief approved, and (I48) the owner''s '
  'notification is retargeted to the deliverable so it deep-links to the owner''s workspace. No '
  'role is named in this function, deliberately.';

commit;
