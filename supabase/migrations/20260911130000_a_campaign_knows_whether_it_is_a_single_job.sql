-- I44 (ADR-0086 d.8–d.11) — a campaign knows whether it is a single job, and a job can grow up.
--
-- WHY A COLUMN. ADR-0083 d.3 made a single job a campaign row, and after it nothing structural
-- told the two apart. "A campaign with no strategy brief" was considered and rejected: that is a
-- null carrying meaning — the fail-silent shape ADR-0079 refused for closures — and it would make
-- every single job look promoted the moment somebody typed a proposition. So `kind` is a STORED
-- FACT, set at creation and never inferred, backfilled `campaign` for every row that exists today
-- because every row that exists today came through the campaign wizard.
--
-- WHO SETS IT. The two creation paths, and only them: `create_campaign_from_brief` (the one-shot
-- path, what the seed and the suites call) and `start_campaign_draft` (the wizard's step-1 path,
-- and the one the single-job flow needs — ADR-0085 d.8: the job exists as a DRAFT from SJ-02, so
-- the receipt and the attachments have a folder to be filed into, and Cancel leaves that draft
-- rather than nothing). Both gain a trailing `p_kind text default 'campaign'`, so every existing
-- caller — the seed, which calls positionally, and the wizard, which calls by name — is unchanged
-- and keeps producing campaigns. A single job passes 'single_job'.
--
-- THE OLD SIGNATURES ARE DROPPED FIRST. A `create or replace` with an extra defaulted parameter
-- does not replace: it creates a SECOND overload, and every seven-argument call — the seed, the
-- suites, the wizard — then fails with "function is not unique", and PostgREST refuses the RPC
-- as ambiguous. Both functions are reproduced whole from `20260903100100`, the last migration to
-- define them (house pattern: a bare replace also drops the ADR-0033 search_path pin).
--
-- PROMOTION IS ONE-WAY (d.11). `promote_single_job` sets `kind = 'campaign'` and nothing else: the
-- row, its receipt, its brief, its deliverable and that deliverable's owner are already there.
-- What a campaign ADDS — strategy, more deliverables, timing — is the existing wizard opened at
-- step 2, which is the frontend's half. Refused if the campaign is already a campaign (`22023`),
-- because a second press would otherwise silently succeed and the modal's "this cannot be undone"
-- would be describing a no-op. Authority is `projects:manage` within scope over the campaign's
-- responsible account manager (ADR-0073), the same test `approve_campaign` applies — no role is
-- named.
--
-- `campaign_list_rows` gains `kind` as its LAST column, so the list can filter on it and offer
-- Promote for single jobs only (d.9). Appending is the only edit `create or replace view` permits.

begin;

-- ---------------------------------------------------------------- the fact ----
alter table campaigns
  add column if not exists kind text not null default 'campaign'
    constraint chk_campaigns_kind check (kind in ('single_job', 'campaign'));

comment on column campaigns.kind is
  'ADR-0086 d.8: single_job | campaign. A STORED fact set at creation, never inferred from which '
  'fields happen to be empty. It is what the campaigns list filters on, what Promote is offered '
  'for, and what tells the wizard it is being opened mid-way. Promotion (d.10/d.11) moves it '
  'single_job -> campaign, one way.';

-- The list filters by kind (d.9) and every existing row is a campaign, so the index is small and
-- selective for the thing it is asked.
create index if not exists idx_campaigns_kind on campaigns (tenant_id, kind)
  where kind = 'single_job';

-- ------------------------------------------------- the one-shot path, plus p_kind ----
-- Reproduced whole from `20260903100100`. The ONLY edits are the trailing parameter, its check, and
-- the column in the insert.
drop function if exists public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid);

create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb,
  p_account_manager uuid default null,
  p_kind text default 'campaign'
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_am       uuid;
begin
  if p_kind is null or p_kind not in ('single_job', 'campaign') then
    raise exception 'kind must be single_job or campaign' using errcode = '22023';
  end if;

  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, account_manager_id, kind)
  values (v_tenant, p_client, p_brand, p_name, v_am, p_kind)
  returning id into v_campaign;

  perform app.write_campaign_content(v_campaign, p_brief, p_go_live, p_deliverables);

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text) is
  'ADR-0020 as revised by ADR-0050/0051, refactored by ADR-0067, and given p_kind by ADR-0086 d.8: '
  'the ONE-SHOT path, creating a campaign at pending_approval in a single call. Shares '
  'app.write_campaign_content with the draft path. p_kind defaults to campaign so every existing '
  'caller is unchanged; a single job passes single_job.';

revoke execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text) from public;
revoke execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text) from anon;
grant  execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid, text) to authenticated;

-- ------------------------------------------------- the draft path, plus p_kind ----
-- Reproduced whole from `20260903100100`, same three edits.
drop function if exists public.start_campaign_draft(uuid, uuid, text, uuid);

create or replace function public.start_campaign_draft(
  p_client          uuid,
  p_brand           uuid,
  p_name            text,
  p_account_manager uuid default null,
  p_kind            text default 'campaign'
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_am       uuid;
  v_campaign uuid;
begin
  if p_kind is null or p_kind not in ('single_job', 'campaign') then
    raise exception 'kind must be single_job or campaign' using errcode = '22023';
  end if;

  -- Fenced to this tenant, exactly as the one-shot path does: a uuid naming somebody else's
  -- employee resolves to null and falls back to the client's account manager, never to an outsider.
  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, account_manager_id, status, kind)
  values (v_tenant, p_client, p_brand, p_name, v_am, 'draft', p_kind)
  returning id into v_campaign;

  return v_campaign;
end $$;

comment on function public.start_campaign_draft(uuid, uuid, text, uuid, text) is
  'ADR-0067 d.1: the campaign the wizard creates on leaving step 1, so step 2 has folders to file '
  'into. Identity only — no brief, no stream, no deliverables. ADR-0086 d.8 adds p_kind (default '
  'campaign); the single-job flow passes single_job here so SJ-02''s draft has folders for its '
  'receipt and attachments (ADR-0085 d.8).';

revoke execute on function public.start_campaign_draft(uuid, uuid, text, uuid, text) from public;
revoke execute on function public.start_campaign_draft(uuid, uuid, text, uuid, text) from anon;
grant  execute on function public.start_campaign_draft(uuid, uuid, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------- promotion ----
create or replace function public.promote_single_job(p_campaign uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v campaigns;
begin
  select * into v from campaigns
   where id = p_campaign and tenant_id = app.current_tenant_id();
  if not found then
    raise exception 'campaign % not found', p_campaign using errcode = 'P0002';
  end if;

  -- d.11: one way, and a second press is an error rather than a silent success — the modal has just
  -- said "this cannot be undone", and a no-op would make that sentence false in the other direction.
  if v.kind <> 'single_job' then
    raise exception 'this is already a campaign' using errcode = '22023';
  end if;

  -- ADR-0073: hold the grant AND be in scope over the campaign's responsible manager. The assigned
  -- AM passes by their account scope, the Account Director by ADR-0074's reach, Power Admin and
  -- Traffic Manager by being tenant-scoped. No role is named.
  if not app.has_permission('projects', 'manage')
     or not app.in_write_scope(null, null, app.campaign_account_manager(p_campaign)) then
    raise exception 'promoting this job is outside your scope' using errcode = '42501';
  end if;

  update campaigns set kind = 'campaign'
   where id = p_campaign and tenant_id = app.current_tenant_id();
end $$;

comment on function public.promote_single_job(uuid) is
  'ADR-0086 d.10/d.11: a single job becomes a campaign. Sets kind only — the row, its receipt, its '
  'brief, its deliverable and its owner are already there; the wizard opened at step 2 is what '
  'adds the rest. One way: refused (22023) if it is already a campaign. projects:manage in scope.';

revoke execute on function public.promote_single_job(uuid) from public;
revoke execute on function public.promote_single_job(uuid) from anon;
grant  execute on function public.promote_single_job(uuid) to authenticated;

-- ------------------------------------------------------------ the list ----
-- Reproduced from `20260908130000`; `kind` appended as the last column, which is the one edit
-- `create or replace view` allows without a drop.
create or replace view campaign_list_rows
with (security_invoker = true) as
select
  c.id,
  c.tenant_id,
  c.name,
  c.status,
  c.go_live_at,
  cl.name                as client_name,
  b.name                 as brand_name,
  am.display_name        as account_manager_name,
  coalesce(db.total, 0)    as department_brief_total,
  coalesce(db.approved, 0) as department_brief_approved,
  coalesce(ow.owners, array[]::text[]) as brief_owner_names,
  c.kind
from campaigns c
join clients cl on cl.id = c.client_id
left join brands b on b.id = c.brand_id
left join user_profiles am on am.id = c.account_manager_id
left join lateral (
  select count(*)::int as total,
         count(*) filter (where cb.approved_at is not null)::int as approved
    from campaign_briefs cb
   where cb.campaign_id = c.id
) db on true
left join lateral (
  select array_agg(distinct p.display_name order by p.display_name) as owners
    from streams s
    join deliverables d on d.stream_id = s.id
    join user_profiles p on p.id = d.owner_user_id
   where s.campaign_id = c.id
) ow on true;

commit;
