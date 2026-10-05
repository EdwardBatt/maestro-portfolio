-- ADR-0083 addendum d.13–d.16 (15 Sep) — I48.38 / I48.40: whoever captures a request captures all
-- of it; the account manager approves, and the refusal names them.
--
-- WHAT WENT WRONG. A real user who was not the client's account manager opened a single job on
-- production. The draft was created and the request text saved (campaigns_tenant_write is
-- projects:manage since 20260903150000), but the receipt — the arrival and its screenshot — was
-- refused: campaign_brief_receipts_manage_write (20260903100200) was written as "the campaign's own
-- write rule, verbatim", and five hours later the campaign's rule was replaced on Edward's
-- instruction ("anyone with project:manage can create, edit and delete… we have audit tracking
-- anyway") because the SAME person-is-not-the-AM refusal had just hit the campaign wizard. The
-- receipts table kept the old copy. Then at Approve the user was refused again — correctly — with
-- a sentence that named nobody.
--
-- 1) THE RECEIPT FOLLOWS THE CAMPAIGN (d.13). One policy re-emitted: tenant + projects:manage, the
--    campaign's current rule. Reading is untouched. Whoever could create the draft can record its
--    evidence; captured_by / confirmed_by and the stamp trigger are the control, as for the row.
--
-- 2) THE REFUSAL NAMES THE ACCOUNT MANAGER (d.15). app.approve_campaign reproduced WHOLE from
--    20260913140000 (its latest definition — grep confirmed); the ONLY edit is the 42501 block,
--    which now carries the responsible account manager's display name in DETAIL (or says none is
--    set) so the screen can say who. The gate itself (d.14) is unchanged.

begin;

-- ---------------------------------------------------------------- 1) the receipt's write rule
drop policy if exists campaign_brief_receipts_manage_write on campaign_brief_receipts;
create policy campaign_brief_receipts_manage_write on campaign_brief_receipts
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('projects', 'manage'));

comment on policy campaign_brief_receipts_manage_write on campaign_brief_receipts is
  'ADR-0083 addendum d.13 (15 Sep): follows campaigns_tenant_write (20260903150000) — anyone with '
  'projects:manage may record a request''s evidence, exactly as they may create the campaign; the '
  'audit stamps are the control, not account scope. Replaces the 20260903100200 copy of the OLD '
  'campaign rule, which refused every capturer who was not the client''s account manager. If the '
  'campaign rule moves again, this one moves with it.';

-- ---------------------------------------------------------------- 2) the refusal names the AM
create or replace function app.approve_campaign(p_campaign uuid) returns void
language plpgsql security definer
set search_path = public, app, extensions as $$
declare v campaigns; v_am uuid; v_am_name text;
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
  'notification is retargeted to the deliverable so it deep-links to the owner''s workspace. '
  'ADR-0083 addendum d.15: the 42501 refusal carries the account manager''s name in DETAIL. No '
  'role is named in this function, deliberately.';

commit;
