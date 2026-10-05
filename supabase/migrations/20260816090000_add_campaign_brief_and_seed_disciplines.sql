-- ADR-0020 (Phase B): the Brief/Campaign Builder wizard.
--
-- 1) campaigns.brief jsonb — the full, possibly discipline-varying strategy brief
--    authored once in Step 2. Additive and backward-safe: existing campaigns keep
--    NULL. audience/insight/proposition remain real columns and are mirrored from
--    the brief on save (queryable; what other surfaces read).
--
-- 2) Seed a starter set of DISCIPLINES as work_types. Streams route to disciplines
--    (streams.work_type_id), so the wizard needs at least one to create a campaign.
--    The names are taken from the design (E2EV1.pen frames 02/07/16/21.5 — the
--    stream/discipline rails and DiscGrid), not invented. Name-only: lead_time_hours
--    and the SLA/accountability profiles stay NULL for the pilot (manual Step-4
--    timing, ADR-0020 §4) and are admin-tunable once the SLA engine lands (M9/P2).
--    Idempotent via uq_work_types_tenant_name.

alter table campaigns add column if not exists brief jsonb;
comment on column campaigns.brief is
  'ADR-0020: full strategy brief (Step 2), possibly discipline-varying. audience/insight/proposition mirror the strategic core for querying.';

create or replace function app.seed_tenant_disciplines(p_tenant uuid) returns void
language plpgsql as $$
begin
  insert into work_types (tenant_id, name)
  select p_tenant, d from (values
    ('Creative'),
    ('Social & Content'),
    ('Production'),
    ('Influencer'),
    ('Activation'),
    ('Paid Media')
  ) as g(d)
  on conflict (tenant_id, name) do nothing;
end $$;

comment on function app.seed_tenant_disciplines(uuid) is
  'ADR-0020: seed design-grounded starter disciplines (work_types) for a tenant. Idempotent; admin-tunable.';

select app.seed_tenant_disciplines(id) from tenants;

-- Future tenants: fold the discipline seed into the provisioning wrapper the
-- bootstrap path already calls, so a freshly provisioned tenant gets disciplines
-- alongside its roles. Thin passthrough — the roles body is unchanged.
create or replace function public.seed_tenant_roles(p_tenant uuid) returns void
language sql as $$
  select app.seed_tenant_roles(p_tenant);
  select app.seed_tenant_disciplines(p_tenant);
$$;
revoke execute on function public.seed_tenant_roles(uuid) from public, anon, authenticated;
grant execute on function public.seed_tenant_roles(uuid) to service_role;

-- Brief submit (ADR-0020 §1/§6). One atomic, RLS-governed transaction writing the
-- existing hierarchy: one campaign, one stream per distinct discipline present, and
-- the deliverables within those streams. SECURITY INVOKER — every insert is checked
-- against the caller's own policies (campaigns/streams need projects:manage +
-- in_write_scope; deliverables need project_tasks:manage). Three sequential client
-- inserts could orphan a campaign on a mid-way failure and then collide on the
-- unique campaign name at retry; a single function makes submit all-or-nothing.
--
-- Account-scoped callers (Account Manager) must own the campaign for the write to
-- pass RLS (in_write_scope's account branch checks campaign_account_manager =
-- auth.uid()); we stamp account_manager_id = auth.uid() for them. Tenant-scoped
-- callers (Scheduler, Power Admin) leave it null — the client's AM fallback applies
-- and their scope passes regardless. department/team-scoped roles don't hold
-- projects:manage, so they can't reach this write at all.
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
as $$
declare
  v_tenant   uuid := app.current_tenant_id();
  v_campaign uuid;
  v_am       uuid := null;
  v_discipline uuid;
  v_deliv    jsonb;
begin
  if app.current_scope() = 'account' then
    v_am := auth.uid();
  end if;

  insert into campaigns (tenant_id, client_id, brand_id, name, brief,
                         audience, insight, proposition, go_live_at, account_manager_id)
  values (
    v_tenant, p_client, p_brand, nullif(btrim(p_name), ''), p_brief,
    nullif(btrim(p_brief ->> 'audiencePrimary'), ''),
    nullif(btrim(p_brief ->> 'insight'), ''),
    nullif(btrim(p_brief ->> 'proposition'), ''),
    p_go_live, v_am
  )
  returning id into v_campaign;

  -- one stream per distinct discipline present in the deliverables
  for v_discipline in
    select distinct (t.elem ->> 'disciplineId')::uuid
    from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) as t(elem)
    where nullif(t.elem ->> 'disciplineId', '') is not null
  loop
    insert into streams (tenant_id, campaign_id, work_type_id, name)
    select v_tenant, v_campaign, v_discipline, wt.name
    from work_types wt
    where wt.id = v_discipline and wt.tenant_id = v_tenant;
  end loop;

  -- deliverables, each attached to its discipline's stream
  for v_deliv in
    select t.elem from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb)) as t(elem)
  loop
    insert into deliverables (tenant_id, stream_id, name, state, due_at)
    select v_tenant, s.id, nullif(btrim(v_deliv ->> 'name'), ''),
           'draft'::deliverable_state, nullif(v_deliv ->> 'dueAt', '')::timestamptz
    from streams s
    where s.campaign_id = v_campaign
      and s.work_type_id = (v_deliv ->> 'disciplineId')::uuid;
  end loop;

  return v_campaign;
end $$;

revoke execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb) from anon;
grant execute on function public.create_campaign_from_brief(uuid, uuid, text, jsonb, timestamptz, jsonb) to authenticated;
