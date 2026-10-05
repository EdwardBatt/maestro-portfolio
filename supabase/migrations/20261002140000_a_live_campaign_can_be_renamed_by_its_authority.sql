-- ADR-0137 (I73.2) — a live campaign or single job is renamed on its page by its approval authority.
--
-- Until now a name could change only while a draft (`update_campaign_draft`, ADR-0067) — and that rule
-- lived in the RPC alone: a PATCH of `campaigns.name` by anyone holding projects:manage went through on
-- a live or closed campaign. The guard below holds the rule in Postgres, as `campaign_brief_guard` does
-- for the brief (I53.4), so the RPC and a PATCH are governed identically (ADR-0037).
--
--   * a draft's name is the wizard's;
--   * a closed campaign is reopened before it is renamed;
--   * otherwise only the campaign's approval authority (`app.is_campaign_authority` — its account
--     manager, Traffic, an Account Director, a Power Admin) may rename it;
--   * the name is trimmed; an empty one is refused; a look-alike is refused by `uq_campaigns_tenant_name`
--     (ADR-0135) as 23505; the Library folder follows (`campaign_folder_follows_name`, 20260922140000).
begin;

create or replace function app.tg_campaign_name_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name then
    return new;
  end if;
  new.name := btrim(new.name);
  if new.name = '' then
    raise exception 'a campaign needs a name' using errcode = '22023';
  end if;
  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if old.status = 'draft' then
    -- The wizard's own draft: update_campaign_draft governs it (ADR-0067).
    return new;
  end if;
  if old.status = 'closed' then
    raise exception 'this campaign is closed — reopen it before renaming it' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(old.id) then
    raise exception
      'renaming this campaign is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_campaign_name_guard() is
  'ADR-0137: who may rename a live campaign or single job — its approval authority, as for its brief. '
  'A draft''s name is the wizard''s; a closed one is reopened first. Held in Postgres so the RPC and a '
  'PATCH are governed identically (ADR-0037).';

drop trigger if exists campaign_name_guard on campaigns;
create trigger campaign_name_guard
  before update of name on campaigns
  for each row execute function app.tg_campaign_name_guard();

-- The page's door. Adds no authority — the guard decides — and refuses in the guard's words.
create or replace function public.rename_campaign(p_campaign uuid, p_name text)
returns text
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
  v_name text;
begin
  select c.status into v_status from campaigns c where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  -- Said here as well as in the guard: a caller whose row write RLS filters out would otherwise read
  -- "nothing happened" for what is a refusal (ADR-0092 — worded, and the same words as the guard's).
  if v_status not in ('draft', 'closed') and not app.is_campaign_authority(p_campaign) then
    raise exception
      'renaming this campaign is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  update campaigns set name = p_name where id = p_campaign and tenant_id = v_tenant
  returning name into v_name;
  return v_name;
end $$;

comment on function public.rename_campaign(uuid, text) is
  'ADR-0137: rename a live campaign or single job from its page. The guard decides who; the name '
  'rule (ADR-0135) refuses a look-alike as 23505; the Library folder follows. Returns the name as saved.';

revoke execute on function public.rename_campaign(uuid, text) from public, anon;
grant execute on function public.rename_campaign(uuid, text) to authenticated;

commit;
