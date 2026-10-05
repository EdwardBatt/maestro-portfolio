-- L1.9 (ADR-0008 Decision 8): everything is logged — universal audit triggers.
--
-- Every INSERT/UPDATE/DELETE on every business table lands in append-only
-- audit_events, regardless of write path: Edge Functions (service role) and
-- direct PostgREST writes (authenticated under RLS) both fire these triggers.
-- Edge Functions ALSO keep their explicit intent events (user_invited,
-- booking approve, …) — the trigger row records WHAT changed, the intent row
-- records WHY; both reference the same entity.
--
-- Payload discipline: UPDATE logs only the changed fields (new values);
-- INSERT/DELETE log the row snapshot. actor_user_id is auth.uid() — null for
-- service-role writes, whose functions attribute the acting user in their
-- intent events. audit_events itself stays INSERT-only (proven in pgTAP 003).

create or replace function app.audit_row_change() returns trigger
language plpgsql as $$
declare
  v_row     jsonb := to_jsonb(coalesce(new, old));
  v_tenant  uuid;
  v_payload jsonb;
begin
  -- tenant: from the row's tenant_id; joint-project tables carry host_tenant_id.
  v_tenant := coalesce(
    nullif(v_row ->> 'tenant_id', '')::uuid,
    nullif(v_row ->> 'host_tenant_id', '')::uuid
  );
  if v_tenant is null then
    return coalesce(new, old); -- non-tenant table: nothing to attribute, skip
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, n.value) into v_payload
    from jsonb_each(to_jsonb(new)) n
    where to_jsonb(old) -> n.key is distinct from n.value;
    if v_payload is null then
      return new; -- no-op update (e.g. touch): nothing changed, nothing to log
    end if;
  else
    v_payload := v_row;
  end if;

  insert into audit_events (tenant_id, actor_user_id, action, entity, entity_id, payload)
  values (
    v_tenant,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    v_payload
  );

  return coalesce(new, old);
end $$;

-- Attach to every business table. audit_events/sla_events are excluded (they
-- ARE the log — append-only, proven in 003). role_grants uses a composite key,
-- so entity_id is null there and the payload identifies the grant.
do $$
declare t text;
begin
  foreach t in array array[
    'offices', 'user_profiles', 'clients', 'brands', 'departments',
    'resources', 'accountability_profiles', 'sla_profiles', 'work_types',
    'campaigns', 'streams', 'jobs', 'deliverables',
    'bookings', 'booking_series', 'resource_unavailability',
    'joint_projects', 'joint_project_grants',
    'media_records', 'review_feedback',
    'roles', 'role_grants'
  ] loop
    execute format(
      'create trigger audit_row_change
         after insert or update or delete on %I
         for each row execute function app.audit_row_change()', t);
  end loop;
end $$;
