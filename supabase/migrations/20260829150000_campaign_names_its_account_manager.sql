-- A campaign names its account manager (Edward, 29 Aug).
--
-- **The bug this closes.** `app.approve_campaign` resolves the approver as
-- `coalesce(campaigns.account_manager_id, clients.account_manager_id)` and refuses when both are
-- null. `create_campaign_from_brief` never set the campaign's, so it was always null — and a
-- campaign under a client with no account manager could be approved by NOBODY. It sat at
-- `pending_approval` for ever, and ADR-0048 d.8 means nothing under it could be assigned or booked.
-- That happened, on the first real campaign created through the wizard.
--
-- Edward: *"the account manager is supposed to be assignable upon creation, the default is the
-- Client Manager."* So the wizard asks, pre-filled from the client, and writes it here.
--
-- WHY THE COLUMN IS STILL NULLABLE. The client's account manager remains a legitimate answer — that
-- is what `coalesce` is for, and a campaign that simply inherits its client's AM should not be
-- forced to restate them. Null means "ask the client", not "nobody". What changed is that the
-- wizard can now say when the answer is somebody else.
--
-- VALIDATED, NOT TRUSTED. This function is `security invoker`, so the caller can send any uuid it
-- likes. The account manager is resolved through `user_profiles` fenced to the caller's own tenant,
-- exactly as `deliverable_type_id` already is (I18.5) — an id from another tenant lands as null
-- rather than as somebody else's employee.
--
-- Reproduced WHOLE from `20260828180000_campaign_from_brief_carries_specification.sql:16`, the
-- house pattern for `create or replace`: a bare replace resets `proconfig` and silently drops the
-- ADR-0033 `search_path` pin. The only edits are the new parameter and the new insert column.

begin;

create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb,
  -- Added 2026-08-29. Defaulted so every existing caller keeps working unchanged.
  p_account_manager uuid default null
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_stream   uuid;
  v_deliv    jsonb;
  v_am       uuid;
begin
  -- Fenced to this tenant. A uuid naming somebody else's employee resolves to null, which falls
  -- back to the client's account manager — never to a person outside the tenant.
  select up.id into v_am from user_profiles up
   where up.id = p_account_manager and up.tenant_id = v_tenant;

  insert into campaigns (tenant_id, client_id, brand_id, name, brief,
                         audience, insight, proposition, go_live_at, account_manager_id)
  values (v_tenant, p_client, p_brand, p_name, p_brief,
          p_brief ->> 'audiencePrimary', p_brief ->> 'insight', p_brief ->> 'proposition',
          p_go_live, v_am)
  returning id into v_campaign;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, v_campaign, p_name)
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

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb, uuid) is
  'ADR-0020 as revised by ADR-0050 and ADR-0051: one campaign, ONE stream, and a deliverable per '
  'row carrying its OWNER and its SPECIFICATION. The department is stamped from the owner and is '
  'never passed. The ACCOUNT MANAGER is named here (29 Aug) because approval resolves '
  'coalesce(campaign, client) and a campaign under a client with none could be approved by nobody. '
  'Both the account manager and the deliverable type are validated against the caller''s tenant, '
  'never trusted.';

-- The six-argument form is gone: `create or replace` cannot change a signature, so the old one
-- would otherwise linger and quietly keep writing campaigns with no account manager.
drop function if exists public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb);

commit;
