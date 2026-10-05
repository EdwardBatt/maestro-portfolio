-- I18.5 (ADR-0051 d.9) — the wizard's specification reaches the deliverable row.
--
-- `20260828170000` gave `deliverables` its specification columns. This is the other half: without
-- it the wizard would collect a type, a channel and a format, and `create_campaign_from_brief`
-- would write them nowhere — which is exactly the failure ADR-0051 was written about. `quantity`
-- has been collected since the wizard was built and filed into a jsonb blob ever since.
--
-- Every new field is OPTIONAL and defaults to null (or 1, for quantity). ADR-0051 d.7: a
-- deliverable with no type is a legal, permanent state, so a brief that classifies nothing still
-- creates a campaign exactly as it does today.
--
-- Reproduced from `20260827230000` with the marked additions.

begin;

create or replace function public.create_campaign_from_brief(
  p_client uuid,
  p_brand uuid,
  p_name text,
  p_brief jsonb,
  p_go_live timestamptz,
  p_deliverables jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_stream   uuid;
  v_deliv    jsonb;
begin
  insert into campaigns (tenant_id, client_id, brand_id, name, brief,
                         audience, insight, proposition, go_live_at)
  values (v_tenant, p_client, p_brand, p_name, p_brief,
          p_brief ->> 'audiencePrimary', p_brief ->> 'insight', p_brief ->> 'proposition',
          p_go_live)
  returning id into v_campaign;

  -- One stream, named for the campaign. It is a container, not a discipline (ADR-0050).
  insert into streams (tenant_id, campaign_id, name)
  values (v_tenant, v_campaign, p_name)
  returning id into v_stream;

  for v_deliv in select * from jsonb_array_elements(p_deliverables)
  loop
    -- owner_user_id is the only PERSON the Account Manager sets. department_id is stamped by
    -- `tg_deliverable_stamp_department` from that person, so it is deliberately not passed.
    --
    -- I18.5: the specification comes with it now. `deliverable_type_id` is validated against the
    -- caller's own tenant rather than trusted — the wizard sends an id from a list it read under
    -- RLS, but this function is `security invoker` and a caller can send whatever it likes.
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

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb) is
  'ADR-0020 as revised by ADR-0050 and ADR-0051: one campaign, ONE stream, and a deliverable per '
  'row carrying its OWNER and its SPECIFICATION. The department is stamped from the owner and is '
  'never passed; the deliverable type is validated against the caller''s tenant, never trusted.';

commit;
