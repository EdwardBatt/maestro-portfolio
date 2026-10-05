-- ADR-0091 / I48.9 — a completed campaign is closed out.
--
-- `campaigns.status` was `draft | pending_approval | approved` with no terminal state, so the list
-- grew forever and a finished campaign looked like one still in flight. This adds the end of the
-- lifecycle: a deliberate close-out by the people who run the campaign, refused while any work under
-- it is unfinished, and reversible.
--
-- The "finished" test is at the DELIVERABLE level (the container ADR-0077 already closes when its
-- tasks are done): a campaign is closable when no deliverable under its streams is still open —
-- none in `draft | in_progress | in_review | blocked`. `approved | delivered | archived` are
-- settled. A campaign with no deliverables at all has nothing unfinished and closes.
--
-- Authority is approval's, exactly (ADR-0073/0074): `projects:manage` AND `in_write_scope` over the
-- campaign's responsible account manager. No role is named. Mirrors `approve_campaign`
-- (`20260911130200`).

begin;

-- The enforcing constraint is `chk_campaigns_status` (`20260827210000`), not the PostgreSQL-default
-- name — drop THAT one and re-add it with the terminal status.
alter table campaigns drop constraint if exists chk_campaigns_status;
alter table campaigns add constraint chk_campaigns_status
  check (status in ('draft', 'pending_approval', 'approved', 'closed'));

alter table campaigns
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references user_profiles(id);

comment on column campaigns.closed_at is
  'ADR-0091: when the campaign was closed out. NULL is open — the absence of a timestamp, the way '
  'approved_at does it. Set by close_out_campaign, cleared by reopen_campaign.';
comment on column campaigns.closed_by is 'ADR-0091: who closed it, from auth.uid().';

-- ---------------------------------------------------------------- closing out ----
create or replace function public.close_out_campaign(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v      campaigns;
  v_am   uuid;
  v_open int;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status = 'closed' then
    return;                                        -- idempotent: the first close-out stands
  end if;
  if v.status <> 'approved' then
    raise exception 'only an approved campaign can be closed out' using errcode = '22023';
  end if;

  -- Authority = approval's (ADR-0073/0074): the grant AND scope over the responsible AM.
  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    raise exception 'you cannot close out this campaign' using errcode = '42501';
  end if;

  -- Refused while work is unfinished (d.3). The count is named so the message can say why.
  select count(*) into v_open
    from deliverables d
    join streams s on s.id = d.stream_id
   where s.campaign_id = v.id
     and d.tenant_id = v.tenant_id
     and d.state in ('draft', 'in_progress', 'in_review', 'blocked');
  if v_open > 0 then
    raise exception
      'this campaign has % deliverable(s) still in progress — finish or archive them before closing it out', v_open
      using errcode = '23514';
  end if;

  update campaigns
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_campaign;
end $$;

comment on function public.close_out_campaign(uuid) is
  'ADR-0091 / I48.9: mark an approved campaign closed once its work is done. Authority is '
  'approve_campaign''s (projects:manage + in_write_scope over the responsible AM). Refused while any '
  'deliverable under it is still open (draft/in_progress/in_review/blocked). Idempotent; reversible '
  'by reopen_campaign.';

revoke execute on function public.close_out_campaign(uuid) from public, anon;
grant  execute on function public.close_out_campaign(uuid) to authenticated;

-- ---------------------------------------------------------------- reopening ----
create or replace function public.reopen_campaign(p_campaign uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare
  v    campaigns;
  v_am uuid;
begin
  select * into v from campaigns where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;
  if v.status <> 'closed' then
    return;                                        -- only a closed campaign reopens; idempotent
  end if;

  select coalesce(v.account_manager_id, cl.account_manager_id) into v_am
    from clients cl where cl.id = v.client_id;
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, v_am) then
    raise exception 'you cannot reopen this campaign' using errcode = '42501';
  end if;

  update campaigns
     set status = 'approved', closed_at = null, closed_by = null
   where id = p_campaign;
end $$;

comment on function public.reopen_campaign(uuid) is
  'ADR-0091 / I48.9: return a closed campaign to approved. Same authority as close_out_campaign.';

revoke execute on function public.reopen_campaign(uuid) from public, anon;
grant  execute on function public.reopen_campaign(uuid) to authenticated;

commit;
