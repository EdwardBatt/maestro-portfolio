-- I40 — a draft keeps the brief that was written into it.
--
-- **The bug this closes.** ADR-0067 promises drafts are *"resumable — a capability the old design
-- could not offer"*, and it also says what splits is *"the campaign's CREATION from its CONTENT"*.
-- Both are in the ADR; only the second was built. `update_campaign_draft` writes brand, name and
-- account manager, `useCampaignDraft` reads back `id, client_id, brand_id, name,
-- account_manager_id`, and everything typed on steps 2 to 4 lives in React state until submit.
--
-- So a draft resumes with step 1 restored and every strategy field blank. Edward, 5 Sep, on
-- returning to step 2: *"all the data is missing… the form is blank."* Nine fields of brief, plus
-- the performance flight, typed and gone — and the wizard says nothing, because from its point of
-- view a fresh draft and a half-written one look identical.
--
-- **The column already exists.** `campaigns.brief` is jsonb and is what `create_campaign_from_brief`
-- writes at submit; the go-live date has its own column. Nothing new is stored here, it is simply
-- stored EARLIER — which is what makes a draft worth resuming.
--
-- **Nulls are ignored, not written.** Both parameters default null and null means "leave it alone",
-- so the existing 4-argument call from step 1 keeps working unchanged and cannot blank a brief that
-- a later step wrote. That matters because step 1 is reachable by going BACK: without this, pressing
-- Next from step 1 a second time would erase everything typed since.
--
-- **Deliverables come too, and need no second shape.** `briefPayload` already nests them inside the
-- same jsonb the submit path sends — name, owner, quantity, dates, type, channel and format — so
-- steps 3 and 4 round-trip through the column that was already going to hold them. No streams are
-- created for a draft and no holding table is invented: the rows in `deliverables` are still made
-- once, by `create_campaign_from_brief`, at submit. What changes is only that the draft remembers
-- what was typed while it waits.
--
-- Reproduced WHOLE from `20260903100100:151`, the house pattern for `create or replace`.

begin;

-- The 4-argument signature is REPLACED by a 6-argument one with defaults. Postgres treats these as
-- different functions, so the old one is dropped explicitly — left in place it would still resolve
-- for the existing call and silently keep discarding the brief.
drop function if exists public.update_campaign_draft(uuid, uuid, text, uuid);

create or replace function public.update_campaign_draft(
  p_campaign        uuid,
  p_brand           uuid,
  p_name            text,
  p_account_manager uuid default null,
  -- ADR-0067, the half that was never built. Null = leave as it is.
  p_brief           jsonb default null,
  p_go_live         timestamptz default null
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_am     uuid;
  v_status text;
begin
  select c.status into v_status from campaigns c
   where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;
  -- Only a draft. A live campaign is edited through the campaign surface, under its own rules.
  if v_status <> 'draft' then
    raise exception 'campaign_not_draft' using errcode = 'check_violation';
  end if;

  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  update campaigns
     set brand_id           = p_brand,
         name               = p_name,
         account_manager_id = v_am,
         -- coalesce, not assignment: a call that does not mention the brief must not erase it.
         brief              = coalesce(p_brief, campaigns.brief),
         go_live_at         = coalesce(p_go_live, campaigns.go_live_at)
   where id = p_campaign and tenant_id = v_tenant;
end $$;

comment on function public.update_campaign_draft(uuid, uuid, text, uuid, jsonb, timestamptz) is
  'ADR-0067: the wizard saving a draft. Brand, name and account manager, plus (I40) the brief and '
  'go-live date so a resumed draft is not blank from step 2 onward. The CLIENT is deliberately '
  'absent — folders are keyed client → Projects → campaign, so moving a filed campaign to another '
  'client is a move, not a rename. Null brief/go-live mean LEAVE ALONE, so going back to step 1 '
  'cannot erase later steps. Draft only — the deliverable ROWS are still made once, at submit.';

revoke execute on function public.update_campaign_draft(uuid, uuid, text, uuid, jsonb, timestamptz) from anon;
grant  execute on function public.update_campaign_draft(uuid, uuid, text, uuid, jsonb, timestamptz) to authenticated;

commit;
