-- I53.19 — An approval tells each owner ONCE, naming what they own (Edward, 21 Sep).
--
-- Action 1 (17 Sep) wrote one `campaign_approved` row per DELIVERABLE, pointing at the
-- deliverable. An owner of four pieces on one campaign therefore got four mails with one subject
-- and one sentence — the inspection walk of 21 Sep showed the Design lead's inbox: "Approved: LUMA
-- Season 2" four times. Edward: *"One email per owner: 'Approved: LUMA Season 2 — you own 4
-- deliverables' + what action is required for the owner."*
--
-- So: ONE row per owner, on the CAMPAIGN (the door that lists every department's brief and every
-- deliverable), with the count and the names in `detail` so the words can say "you own 4
-- deliverables: …" and what is required. The recipient set does not change — the owners, never
-- the approver, never a department lead by role (Action 1). A single job has one deliverable, so
-- its owner still gets exactly one row, now on the job; the job's page points at the deliverable.
--
-- Reproduced from 20260917110000 (its latest definition); the final insert is the change.

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
  -- how many deliverables are theirs and which, so the mail can say "you own 4 deliverables" and
  -- what is required. Never the approver.
  insert into notifications (tenant_id, user_id, type, label, entity_type, entity_id, actor_id, detail)
  select v.tenant_id, d.owner_user_id, 'campaign_approved', v.name, 'campaign', v.id, auth.uid(),
         jsonb_build_object(
           'deliverable_count', count(*),
           'deliverables', jsonb_agg(d.name order by d.created_at),
           'due_at', min(d.due_at))
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = p_campaign
     and d.owner_user_id is not null
     and d.owner_user_id is distinct from auth.uid()
   group by d.owner_user_id;
end $$;

comment on function app.approve_campaign(uuid) is
  'ADR-0048 d.9 / ADR-0073: approve a campaign under projects:manage in scope of its account '
  'manager. Action 1: each deliverable owner is told — I53.19: once, on the campaign, with the '
  'count and names of what they own in detail.';

commit;
