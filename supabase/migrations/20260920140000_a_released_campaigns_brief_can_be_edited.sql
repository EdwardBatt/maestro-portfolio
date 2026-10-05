-- I53.4 — ADR-0086 addendum (11 Sep) sent Promote to the campaign page "where an approved campaign
-- gains departments and deliverables"; I48.43 (15 Sep) found the page could do neither. The
-- deliverables half landed as I52.20 / I52.21. This is the brief half: the master brief of a
-- RELEASED campaign (pending approval, approved) can be edited on its page by the campaign's
-- approval authority — the account manager, or projects:manage with reach over them — so a job
-- promoted to a campaign can have its brief rewritten for the bigger scope, and new deliverables
-- proposed from it (the page's Generate, through add_campaign_deliverable: existing rows are never
-- touched).
--
--   * app.tg_campaign_brief_guard — before update of brief: a draft's brief is the wizard's
--     (update_campaign_draft, the creator's); a released campaign's brief is the authority's. The
--     three denormalised columns (audience / insight / proposition) follow the brief on every
--     change, whichever door wrote it, so they can never disagree with it again.
--   * public.update_campaign_brief — the RPC; adds no authority of its own (ADR-0037).
--
-- Additive: a trigger and a function. No row changes.

begin;

create or replace function app.tg_campaign_brief_guard() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.brief is not distinct from old.brief then
    return new;
  end if;
  -- The columns the list and the dashboards read follow the document.
  new.audience    := new.brief ->> 'audiencePrimary';
  new.insight     := new.brief ->> 'insight';
  new.proposition := new.brief ->> 'proposition';

  if auth.uid() is null or app.is_system_op() then
    return new;
  end if;
  if old.status = 'draft' then
    -- The wizard's own draft: update_campaign_draft governs it (ADR-0067).
    return new;
  end if;
  if old.status = 'closed' then
    raise exception 'this campaign is closed — reopen it before editing its brief' using errcode = '22023';
  end if;
  if not app.is_campaign_authority(old.id) then
    raise exception
      'editing this campaign''s brief is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  return new;
end $$;

comment on function app.tg_campaign_brief_guard() is
  'I53.4: who may change a released campaign''s master brief — the campaign''s approval authority. '
  'A draft''s brief is the wizard''s. audience/insight/proposition follow the brief on every write. '
  'Held in Postgres so the RPC and a PATCH are governed identically (ADR-0037).';

drop trigger if exists campaign_brief_guard on campaigns;
create trigger campaign_brief_guard
  before update of brief on campaigns
  for each row execute function app.tg_campaign_brief_guard();

create or replace function public.update_campaign_brief(p_campaign uuid, p_brief jsonb)
returns void
language plpgsql security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
begin
  if p_brief is null or jsonb_typeof(p_brief) <> 'object' then
    raise exception 'a brief is a document' using errcode = '22023';
  end if;
  select c.status into v_status from campaigns c where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign not found' using errcode = 'P0002';
  end if;
  -- Said here as well as in the guard: a caller whose row write RLS filters out would otherwise
  -- read "not found" for what is a refusal (ADR-0092 — worded, and the same words as the guard's).
  if v_status <> 'draft' and not app.is_campaign_authority(p_campaign) then
    raise exception
      'editing this campaign''s brief is outside your reach — its account manager, Traffic, an Account Director or a Power Admin can'
      using errcode = '42501';
  end if;
  update campaigns set brief = p_brief where id = p_campaign and tenant_id = v_tenant;
end $$;

comment on function public.update_campaign_brief(uuid, jsonb) is
  'I53.4: rewrite a released campaign''s master brief on its page. Adds no authority — '
  'app.tg_campaign_brief_guard decides.';

revoke execute on function public.update_campaign_brief(uuid, jsonb) from public, anon;
grant  execute on function public.update_campaign_brief(uuid, jsonb) to authenticated;

commit;
