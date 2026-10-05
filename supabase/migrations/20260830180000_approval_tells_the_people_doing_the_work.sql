-- I16.6 (ADR-0048 d.10) — approving a campaign tells the people who have to act on it.
--
-- **Today it tells almost nobody, and usually literally nobody.** `app.approve_campaign` notifies
-- `sub_task_reviewers` — the reviewers appointed to tasks. At the moment of approval the tasks have
-- just been materialised: unassigned, with no reviewers. So the query matches zero rows, and a
-- campaign goes live in silence.
--
-- Edward, 30 Aug: *"once approved what is actually sent to each deliverable manager?"* The honest
-- answer was nothing, and he named who it should be: **the department leads and the deliverable
-- owners.**
--
-- WHY THOSE TWO, AND NOT "EVERYONE ON THE CAMPAIGN". An approved campaign is a release of work, and
-- the two people it lands on are the person accountable for a deliverable (`owner_user_id`, ADR-0050)
-- and the person who has to find somebody to do it. Nobody has been assigned anything yet, so
-- notifying assignees is notifying an empty set — which is exactly the bug being fixed.
--
-- Reviewers are KEPT. They are usually empty at approval, but a campaign approved after work has
-- already been appointed (a correction, a re-approval) should still tell them. `distinct` across the
-- whole union means somebody who is both an owner and a lead is told once.

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

  -- ADR-0048 d.9: the account manager approves. The campaign is the subject here, so
  -- coalesce(campaign, client) is resolved directly rather than through a deliverable that may not
  -- exist yet.
  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;

  if v_am is null or v_am is distinct from auth.uid() then
    raise exception 'only this campaign''s account manager can approve it'
      using errcode = '42501';
  end if;

  update campaigns
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_campaign;

  -- d.10, corrected. Three groups, unioned and de-duplicated, and the actor is never told about
  -- their own approval.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id)
  select distinct v.tenant_id, x.user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid()
  from (
    -- 1. THE DELIVERABLE OWNERS. The person accountable for the thing (ADR-0050). This is the
    --    group the old query missed entirely, and the one Edward asked for first.
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
  where x.user_id is not null and x.user_id is distinct from auth.uid();
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.9/d.10, corrected 30 Aug: the account manager approves, and the people who have to '
  'act are told — every DELIVERABLE OWNER, every DEPARTMENT LEAD with work on the campaign, and any '
  'reviewer already appointed. It previously notified reviewers alone, which at approval time is an '
  'empty set, so an approved campaign went live in silence.';

commit;
