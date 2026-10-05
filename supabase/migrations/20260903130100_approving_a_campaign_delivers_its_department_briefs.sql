-- I37.3 (ADR-0070 d.6) — approving the campaign DELIVERS each department's brief to its leads.
--
-- Edward: *"when the account manager approves the brief, the department level briefs need to be
-- delivered to assigned department leads"* — and, on how: *"notification (in app and email) with a
-- meaningful message and in app link to the dept brief for the specified campaign."*
--
-- WHY A SECOND TYPE RATHER THAN REUSING `campaign_approved`. That one already reaches department
-- leads, and it says the campaign was approved — which after ADR-0070 is no longer the thing they
-- have to act on. "Your brief is waiting for you, and nothing can be assigned until you accept it"
-- is a different sentence with a different consequence, and a notification that does not say what
-- the reader must DO is the kind ADR-0045 warns trains people to ignore an inbox.
--
-- AND THEY MUST NOT BOTH ARRIVE. A lead of a department that has a brief now gets the specific
-- message and NOT the generic one; a lead of a department with no brief on this campaign still gets
-- `campaign_approved`, because for them nothing else is true. Two notifications about one event is
-- exactly the noise the ADR-0045 rule exists to prevent.
--
-- NOT SENT TO POWER ADMIN OR TRAFFIC MANAGER (d.6). They can approve any department's brief, so
-- including them would deliver every brief in the agency to two inboxes. The failsafe is a
-- capability, not a queue.
--
-- `approve_campaign` is reproduced WHOLE from `20260830180000` — the house pattern, because a bare
-- `create or replace` resets `proconfig` and drops the ADR-0033 `search_path` pin.

begin;

-- ---------------------------------------------------------------- the type ----
-- Reproduced from `20260903110000`, which is the current definition — NOT from memory. This
-- constraint is drop-and-recreate, so anything omitted here is silently un-emittable afterwards;
-- writing it from recall has already dropped `dependency_ready` once.
-- Check with: grep -rln "notifications_type_check" supabase/migrations/*.sql | tail -1
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('assigned','review_requested','changes_requested','signed_off','blocked',
                  'due_soon','dependency_ready','cancelled','resource_clash','resource_required',
                  'campaign_approved','deliverable_reassigned','rescheduled','chat_added',
                  'task_reinstated','brief_awaiting_approval'));

comment on constraint notifications_type_check on notifications is
  'ADR-0028 + I31.7 + ADR-0068 d.6 + ADR-0070 d.6. Every value here needs COPY in notify-email or '
  'it is silently in-app only, AND copy under `notifications.type.*` in EN and AR or the inbox '
  'renders the raw key at the reader. Both have already been missed more than once.';

-- ---------------------------------------------------------------- delivery ----
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

  -- ADR-0070 d.6. FIRST, because the generic notice below excludes whoever gets this one.
  --
  -- To the people whose department it is: its leads, its team leads, and a deputy standing in for
  -- one. Scope is what makes them the right recipients, and it is the same set `briefs:approve`
  -- was seeded to minus the two agency-wide roles — deliberately, since those two can approve
  -- anything and would otherwise receive every brief in the agency.
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
  'ADR-0048 d.9/d.10 as extended by ADR-0070 d.6: approving a campaign now also DELIVERS each '
  'unapproved department brief to that department''s leads, and those recipients are excluded from '
  'the generic campaign_approved notice so one event produces one message.';

commit;
