-- I35.4 (ADR-0067) — a campaign exists from step 2 of the wizard, as a draft.
--
-- WHY. The wizard writes nothing until its last step, which was right for a form and stops being
-- right the moment the form must file documents: a document needs a folder, and a folder needs a
-- campaign. ADR-0044 §8 already works around this by filing the brief document AFTER submit, with a
-- carefully written promise-then-apologise path — for ONE file. Reference materials on step 2 would
-- scale that apology to N files and still give the user no folder tree on the step where the files
-- are chosen.
--
-- THE SLOT ALREADY EXISTED. `chk_campaigns_status` has permitted `draft` since the approval gate
-- (ADR-0048 d.8) and **nothing has ever created one** — the wizard's RPC writes `pending_approval`,
-- and every other `'draft'` in these migrations is a `deliverable_state`, a different type. And
-- `app.provision_campaign_folders` fires on INSERT, so a draft campaign gets Working Files /
-- Deliverables / Final Assets / References for free. No provisioning code is added here.
--
-- WHAT SPLITS, AND WHAT DOES NOT. The campaign's CREATION moves to step 2; its CONTENT — the brief,
-- the stream, the deliverables — is still written in one statement at submit. To make that literally
-- true rather than approximately true, the content writer is factored into
-- `app.write_campaign_content` and BOTH entry points call it. One writer, two doors. Duplicating the
-- body into a second function is how the two would drift, and the deliverable insert in it is
-- exactly the code that carries ADR-0051's specification and ADR-0050's owner-stamped department.
--
-- THE CLIENT IS NOT UPDATABLE ON A DRAFT, and this is the sharp edge worth reading. Folders are
-- keyed `client → Projects → campaign`, so moving a campaign to another client after files are filed
-- under the first is a MOVE, not a rename — ADR-0067 says so and deliberately does not make it
-- possible. `update_campaign_draft` therefore changes the brand, the name and the account manager
-- and refuses the client. A wizard that needs to change it discards the draft (which the function
-- below refuses to do once anything is filed) and starts again.
--
-- `create_campaign_from_brief` IS KEPT. It is not dead: it is the one-shot path, it is what the
-- pgTAP suites exercise, and after this migration it shares its entire body with the draft path, so
-- there is nothing to drift. It is reproduced WHOLE per the house pattern — a bare `create or
-- replace` resets `proconfig` and silently drops the ADR-0033 `search_path` pin.

begin;

-- ------------------------------------------------ the one content writer ----
-- Everything that turns an empty campaign into a briefed one. Called by the one-shot path and by
-- the draft-completion path, so ADR-0051's specification columns and ADR-0050's owner rule have
-- exactly one implementation.
create or replace function app.write_campaign_content(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb
) returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_name   text;
  v_stream uuid;
  v_deliv  jsonb;
begin
  update campaigns
     set brief       = p_brief,
         audience    = p_brief ->> 'audiencePrimary',
         insight     = p_brief ->> 'insight',
         proposition = p_brief ->> 'proposition',
         go_live_at  = p_go_live
   where id = p_campaign and tenant_id = v_tenant
  returning name into v_name;

  if v_name is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, p_campaign, v_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- owner_user_id is the only PERSON the Account Manager sets per row. department_id is stamped
    -- by `tg_deliverable_stamp_department` from that person, so it is deliberately not passed.
    insert into deliverables (
      tenant_id, stream_id, name, state, due_at, owner_user_id,
      deliverable_type_id, quantity, channel, format
    )
    values (
      v_tenant,
      v_stream,
      v_deliv ->> 'name',
      'draft',
      nullif(v_deliv ->> 'dueAt', '')::timestamptz,
      nullif(v_deliv ->> 'ownerUserId', '')::uuid,
      (select dt.id from deliverable_types dt
        where dt.id = nullif(v_deliv ->> 'deliverableTypeId', '')::uuid
          and dt.tenant_id = v_tenant),
      greatest(coalesce(nullif(v_deliv ->> 'quantity', '')::int, 1), 1),
      nullif(v_deliv ->> 'channel', ''),
      nullif(v_deliv ->> 'format', '')
    );
  end loop;
end $$;

comment on function app.write_campaign_content(uuid, jsonb, timestamptz, jsonb) is
  'ADR-0067: the brief, the ONE stream and the deliverables — the content half of creating a '
  'campaign, shared by create_campaign_from_brief and complete_campaign_draft so the two cannot '
  'drift. Carries ADR-0051 specification and ADR-0050 owner-stamped department.';

-- `authenticated` inherits from PUBLIC, so revoking from PUBLIC alone takes execute away from the
-- two `security invoker` callers above and the draft path fails at submit with a bare
-- `permission denied for function write_campaign_content`. Revoke, then grant back explicitly.
--
-- Granting it to `authenticated` opens no door: PostgREST serves the `public` schema only, so
-- nothing in `app` is reachable from the browser, and the function is `security invoker` — every
-- row it writes goes through `campaigns_tenant_write`, `streams_tenant_write` and the deliverables
-- policy exactly as if the caller had written it by hand.
revoke execute on function app.write_campaign_content(uuid, jsonb, timestamptz, jsonb) from public;
grant  execute on function app.write_campaign_content(uuid, jsonb, timestamptz, jsonb) to authenticated;

-- ------------------------------------------------------- step 1 → step 2 ----
create or replace function public.start_campaign_draft(
  p_client          uuid,
  p_brand           uuid,
  p_name            text,
  p_account_manager uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_am       uuid;
  v_campaign uuid;
begin
  -- Fenced to this tenant, exactly as the one-shot path does: a uuid naming somebody else's
  -- employee resolves to null and falls back to the client's account manager, never to an outsider.
  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, account_manager_id, status)
  values (v_tenant, p_client, p_brand, p_name, v_am, 'draft')
  returning id into v_campaign;

  return v_campaign;
end $$;

comment on function public.start_campaign_draft(uuid, uuid, text, uuid) is
  'ADR-0067 d.1: the campaign the wizard creates on leaving step 1, so step 2 has folders to file '
  'into. Identity only — no brief, no stream, no deliverables. The name is claimed here, so a '
  'duplicate is reported at step 2 rather than after five steps (d.5).';

revoke execute on function public.start_campaign_draft(uuid, uuid, text, uuid) from anon;
grant  execute on function public.start_campaign_draft(uuid, uuid, text, uuid) to authenticated;

-- --------------------------------------------- going back to step 1 again ----
create or replace function public.update_campaign_draft(
  p_campaign        uuid,
  p_brand           uuid,
  p_name            text,
  p_account_manager uuid default null
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
     set brand_id = p_brand, name = p_name, account_manager_id = v_am
   where id = p_campaign and tenant_id = v_tenant;
end $$;

comment on function public.update_campaign_draft(uuid, uuid, text, uuid) is
  'ADR-0067: the wizard going back to step 1. Brand, name and account manager only — the CLIENT is '
  'deliberately absent, because folders are keyed client → Projects → campaign and moving a filed '
  'campaign to another client is a move, not a rename. Draft only.';

revoke execute on function public.update_campaign_draft(uuid, uuid, text, uuid) from anon;
grant  execute on function public.update_campaign_draft(uuid, uuid, text, uuid) to authenticated;

-- --------------------------------------------------- abandoning it safely ----
create or replace function public.discard_campaign_draft(p_campaign uuid)
returns void
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
  v_assets bigint;
begin
  select c.status into v_status from campaigns c
   where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'draft' then
    raise exception 'campaign_not_draft' using errcode = 'check_violation';
  end if;

  -- Deleting the campaign cascades to its folders and everything filed in them. That is fine for an
  -- empty tree and is destruction of somebody's work for a filled one, so the count decides. It is
  -- NOT a race worth locking against: two people are not filling in the same draft wizard.
  select count(*) into v_assets
    from assets a join asset_folders f on f.id = a.folder_id
   where f.campaign_id = p_campaign;

  if v_assets > 0 then
    raise exception 'campaign_draft_has_assets' using errcode = 'check_violation';
  end if;

  delete from campaigns where id = p_campaign and tenant_id = v_tenant;
end $$;

comment on function public.discard_campaign_draft(uuid) is
  'ADR-0067 d.7: a draft is deleted BY HAND, never on a timer, and never once anything is filed '
  'under it — deleting the campaign cascades to its folders and would take the documents with it.';

revoke execute on function public.discard_campaign_draft(uuid) from anon;
grant  execute on function public.discard_campaign_draft(uuid) to authenticated;

-- ---------------------------------------------------------------- submit ----
create or replace function public.complete_campaign_draft(
  p_campaign     uuid,
  p_brief        jsonb,
  p_go_live      timestamptz,
  p_deliverables jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant uuid := app.current_tenant_id();
  v_status text;
begin
  select c.status into v_status from campaigns c
   where c.id = p_campaign and c.tenant_id = v_tenant;
  if v_status is null then
    raise exception 'campaign_not_found' using errcode = 'no_data_found';
  end if;
  -- Refuses a second submit rather than writing a second stream and a second set of deliverables.
  if v_status <> 'draft' then
    raise exception 'campaign_not_draft' using errcode = 'check_violation';
  end if;

  perform app.write_campaign_content(p_campaign, p_brief, p_go_live, p_deliverables);

  update campaigns set status = 'pending_approval'
   where id = p_campaign and tenant_id = v_tenant;

  return p_campaign;
end $$;

comment on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb) is
  'ADR-0067 d.4: the wizard''s submit. Writes the brief, the stream and the deliverables through '
  'app.write_campaign_content — the same writer the one-shot path uses — then moves the campaign '
  'draft → pending_approval. Refuses anything that is not a draft, so a double submit cannot '
  'produce a second stream.';

revoke execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb) from anon;
grant  execute on function public.complete_campaign_draft(uuid, jsonb, timestamptz, jsonb) to authenticated;

-- ------------------------------------------- the one-shot path, refactored ----
-- Reproduced whole (house pattern: a bare replace drops the ADR-0033 search_path pin). The body is
-- now the identity insert plus the shared content writer; nothing about what it produces changes.
create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb,
  p_account_manager uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_am       uuid;
begin
  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, account_manager_id)
  values (v_tenant, p_client, p_brand, p_name, v_am)
  returning id into v_campaign;

  perform app.write_campaign_content(v_campaign, p_brief, p_go_live, p_deliverables);

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid) is
  'ADR-0020 as revised by ADR-0050/0051 and refactored by ADR-0067: the ONE-SHOT path, creating a '
  'campaign at pending_approval in a single call. Shares app.write_campaign_content with the draft '
  'path, so the brief, the stream and the deliverable specification have one implementation. The '
  'wizard now uses start_campaign_draft + complete_campaign_draft; this remains the direct path.';

commit;
