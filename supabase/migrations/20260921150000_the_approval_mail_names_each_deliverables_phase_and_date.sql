-- I53.19, continued (Edward, 21 Sep) — the approval mail names each deliverable with its phase and
-- its due date.
--
-- 20260921110000 made the approval ONE row per owner and put the names of what they own in
-- `detail.deliverables`. The mail then could not say each piece's phase — one facts line cannot
-- carry four phases — and it fell back to the earliest due date. Edward: *"explain why phase is
-- not included in the email.. this makes no sense to me"*, then *"do it that way"*: the list in
-- the body, one line per deliverable — name, phase, due date.
--
-- So `detail.deliverables` becomes an array of objects {name, due_at, phase_number, phase_name}
-- (the phase read at approval, null on a campaign without phases). `notify-email` prints one line
-- each; it still accepts the plain-string array the rows of earlier today carry.
--
-- app.approve_campaign reproduced from 20260921110000 (its latest definition); the aggregate is
-- the change.

begin;

create or replace function app.approve_campaign(p_campaign uuid)
 returns void
 language plpgsql
 security definer
 set search_path = public, app, extensions
as $$
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
             'phase_number', p.number, 'phase_name', p.name) order by d.created_at),
           'due_at', min(d.due_at))
    from deliverables d
    join streams s on s.id = d.stream_id
    left join campaign_phases p on p.id = d.phase_id
   where s.campaign_id = p_campaign
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid()
   group by d.owner_user_id;
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.9 / ADR-0073: approve a campaign under projects:manage in scope of its account '
  'manager. Action 1: each deliverable owner is told — I53.19: once, on the campaign, with the '
  'count of what they own and each piece''s name, phase and due date in detail.';

commit;
