-- ADR-0050 d.1/d.2/d.6: the wizard sends an OWNER per deliverable, not a discipline.
--
-- `create_campaign_from_brief` created one stream per distinct discipline, because ADR-0020
-- made discipline the organising unit and ADR-0048 doubled down on it. ADR-0050 supersedes
-- that: the person accountable is what the Account Manager sets, and the department follows
-- from them.
--
-- So the campaign gets ONE stream. `deliverables` still needs a parent (the
-- `chk_deliverables_has_parent` check), and a stream is the campaign's own container — it is
-- no longer a discipline in disguise. Whether `work_types` and `departments` should merge is
-- left open by ADR-0050 d.8, deliberately; nothing here forecloses it.

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
    -- owner_user_id is the only thing the Account Manager sets. department_id is stamped by
    -- `tg_deliverable_stamp_department` from that person, so it is deliberately not passed.
    insert into deliverables (tenant_id, stream_id, name, state, due_at, owner_user_id)
    values (
      v_tenant,
      v_stream,
      v_deliv ->> 'name',
      'draft',
      nullif(v_deliv ->> 'dueAt', '')::timestamptz,
      nullif(v_deliv ->> 'ownerUserId', '')::uuid
    );
  end loop;

  return v_campaign;
end $$;

comment on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb) is
  'ADR-0020 as revised by ADR-0050: one campaign, ONE stream, and a deliverable per row carrying '
  'its OWNER. Streams are no longer one-per-discipline - the person accountable is what is asked '
  'for, and the department is stamped from them.';
