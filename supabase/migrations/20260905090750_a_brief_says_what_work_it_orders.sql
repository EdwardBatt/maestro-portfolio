-- I38.1 (ADR-0071 d.1) — which deliverable types each brief orders.
--
-- THE GAP THIS CLOSES. Nothing has ever linked a brief to the work it can produce. The wizard
-- offers all 269 types on every brief, sorted by category, so Bottle and Billboard sit beside Reel
-- on a social brief — and `propose-concepts` (ADR-0065) picks its suggested content types from the
-- whole taxonomy for the same reason. Asked on 5 Sep how a campaign type matched the content it
-- produces, the honest answer was that nothing said so and I had been inferring it from names,
-- which is the mapping-by-name-similarity Edward corrected on 30 August.
--
-- Seeded from the mapping worked through and accepted on 5 September
-- (`docs/reference/DRAFT_Taxonomy_Brief_Workflow_Mapping.xlsx`), and GENERATED from that same
-- source rather than retyped, so the table and the sheet cannot disagree.
--
--   activation                  38 types
--   brand_guidelines            12 types
--   campaign_360                17 types
--   communications_strategy      8 types
--   creative_strategy           10 types
--   digital_build                7 types
--   influencer                   6 types
--   paid_media                  33 types
--   production                  47 types
--   single_execution           111 types
--   social_calendar             28 types
--
-- IT SORTS. IT DOES NOT RESTRICT (d.1). The brief's own types come first in the picker and
-- everything else stays reachable below. A hard limit would turn every gap in a judgement about an
-- agency into somebody unable to do their job at five o'clock — and it means this table can be
-- wrong in production without blocking anyone, which is the right property for a first attempt at
-- a 269-row opinion.
--
-- `brief_type` IS TEXT AND NOT A FOREIGN KEY to `brief_templates`, deliberately. A tenant may
-- delete or rename a brief template (ADR-0051 d.3 makes the list theirs), and doing so must not
-- cascade away the deliverable mapping. It also lets ONE reserved key exist with no template row
-- behind it: `campaign_360`.
--
-- WHY `campaign_360` HAS NO TEMPLATE. There are two briefs in this system and only one uses a
-- template. The department briefs are `campaign_briefs` rows generated from `brief_templates`,
-- chosen through `department_brief_templates`. The CAMPAIGN-level brief is the wizard's own step 2
-- — the deck's 360 Creative Brief — and its nine strategy fields are hardcoded in
-- `BriefWizard.tsx`, not stored as a template, which is why `campaign-api.ts:120` says there is no
-- campaign-level brief TYPE. The campaign-level work (the idea, the key visual, the toolkit) still
-- needs somewhere to hang, so it hangs here under a reserved key. If a `campaign_360` template is
-- ever authored, its mapping is already written.

begin;

create table brief_deliverable_types (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id),
  brief_type          text not null check (length(trim(brief_type)) > 0),
  deliverable_type_id uuid not null references deliverable_types(id) on delete cascade,
  created_at          timestamptz not null default now(),
  constraint uq_brief_deliverable_types unique (tenant_id, brief_type, deliverable_type_id)
);

create index idx_brief_deliverable_types_tenant on brief_deliverable_types (tenant_id);
create index idx_brief_deliverable_types_brief  on brief_deliverable_types (tenant_id, brief_type);

comment on table brief_deliverable_types is
  'ADR-0071 d.1: which deliverable types a brief type orders. SORTS the picker and the model''s '
  'candidate list; never restricts either. brief_type is text, not a foreign key — a deleted brief '
  'template must not take the mapping with it, and campaign_360 has no template row at all.';

alter table brief_deliverable_types enable row level security;
alter table brief_deliverable_types force row level security;

-- Read by everyone in the tenant: a picker that cannot read its list cannot render.
create policy brief_deliverable_types_tenant_select on brief_deliverable_types
  for select using (tenant_id = app.current_tenant_id());

-- Written under the authority that already writes roles, offices, brief_templates and
-- deliverable_types. No new permission (d.1).
create policy brief_deliverable_types_manage_insert on brief_deliverable_types
  for insert with check (
    tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage')
  );
create policy brief_deliverable_types_manage_update on brief_deliverable_types
  for update using (
    tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage')
  ) with check (
    tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage')
  );
create policy brief_deliverable_types_manage_delete on brief_deliverable_types
  for delete using (
    tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage')
  );

create trigger audit_row_change after insert or update or delete on brief_deliverable_types
  for each row execute function app.audit_row_change();

-- ============================================================================
-- the seed
-- ============================================================================
create or replace function app.seed_tenant_brief_deliverable_types(p_tenant uuid) returns void
language plpgsql as $$
begin
  insert into brief_deliverable_types (tenant_id, brief_type, deliverable_type_id)
  select p_tenant, m.brief_type, dt.id
    from (values
    ('activation', 'ENV-001'),
    ('activation', 'ENV-002'),
    ('activation', 'ENV-003'),
    ('activation', 'ENV-004'),
    ('activation', 'ENV-005'),
    ('activation', 'ENV-007'),
    ('activation', 'ENV-008'),
    ('activation', 'ENV-012'),
    ('activation', 'ENV-013'),
    ('activation', 'ENV-015'),
    ('activation', 'EVT-001'),
    ('activation', 'EVT-002'),
    ('activation', 'EVT-003'),
    ('activation', 'EVT-004'),
    ('activation', 'EVT-005'),
    ('activation', 'EVT-006'),
    ('activation', 'EVT-007'),
    ('activation', 'EVT-008'),
    ('activation', 'EVT-009'),
    ('activation', 'EVT-010'),
    ('activation', 'EVT-011'),
    ('activation', 'EVT-012'),
    ('activation', 'MER-001'),
    ('activation', 'MER-002'),
    ('activation', 'MER-003'),
    ('activation', 'MER-004'),
    ('activation', 'MER-005'),
    ('activation', 'MER-006'),
    ('activation', 'MER-007'),
    ('activation', 'MER-008'),
    ('activation', 'MER-009'),
    ('activation', 'MER-010'),
    ('activation', 'MER-011'),
    ('activation', 'PHO-006'),
    ('activation', 'PRT-005'),
    ('activation', 'PRT-006'),
    ('activation', 'PRT-013'),
    ('activation', 'PRT-019'),
    ('brand_guidelines', 'GUI-001'),
    ('brand_guidelines', 'GUI-002'),
    ('brand_guidelines', 'GUI-003'),
    ('brand_guidelines', 'GUI-004'),
    ('brand_guidelines', 'GUI-005'),
    ('brand_guidelines', 'GUI-006'),
    ('brand_guidelines', 'GUI-007'),
    ('brand_guidelines', 'GUI-008'),
    ('brand_guidelines', 'GUI-009'),
    ('brand_guidelines', 'GUI-010'),
    ('brand_guidelines', 'GUI-011'),
    ('brand_guidelines', 'GUI-012'),
    ('campaign_360', 'CAM-001'),
    ('campaign_360', 'CAM-002'),
    ('campaign_360', 'CAM-003'),
    ('campaign_360', 'CAM-004'),
    ('campaign_360', 'CAM-005'),
    ('campaign_360', 'CAM-006'),
    ('campaign_360', 'CAM-007'),
    ('campaign_360', 'CAM-008'),
    ('campaign_360', 'CAM-009'),
    ('campaign_360', 'CAM-010'),
    ('campaign_360', 'CAM-011'),
    ('campaign_360', 'CNT-005'),
    ('campaign_360', 'CNT-006'),
    ('campaign_360', 'CNT-007'),
    ('campaign_360', 'PHO-001'),
    ('campaign_360', 'PRE-006'),
    ('campaign_360', 'SOC-018'),
    ('communications_strategy', 'PRE-005'),
    ('communications_strategy', 'STR-006'),
    ('communications_strategy', 'STR-009'),
    ('communications_strategy', 'STR-013'),
    ('communications_strategy', 'STR-014'),
    ('communications_strategy', 'STR-015'),
    ('communications_strategy', 'STR-016'),
    ('communications_strategy', 'STR-017'),
    ('creative_strategy', 'CAM-001'),
    ('creative_strategy', 'PRE-005'),
    ('creative_strategy', 'STR-002'),
    ('creative_strategy', 'STR-005'),
    ('creative_strategy', 'STR-006'),
    ('creative_strategy', 'STR-007'),
    ('creative_strategy', 'STR-008'),
    ('creative_strategy', 'STR-009'),
    ('creative_strategy', 'STR-010'),
    ('creative_strategy', 'STR-011'),
    ('digital_build', 'DIG-001'),
    ('digital_build', 'DIG-002'),
    ('digital_build', 'DIG-003'),
    ('digital_build', 'DIG-004'),
    ('digital_build', 'DIG-012'),
    ('digital_build', 'DIG-013'),
    ('digital_build', 'DIG-014'),
    ('influencer', 'INF-001'),
    ('influencer', 'INF-002'),
    ('influencer', 'INF-003'),
    ('influencer', 'INF-004'),
    ('influencer', 'INF-005'),
    ('influencer', 'INF-006'),
    ('paid_media', 'ADV-001'),
    ('paid_media', 'ADV-002'),
    ('paid_media', 'ADV-003'),
    ('paid_media', 'ADV-004'),
    ('paid_media', 'ADV-005'),
    ('paid_media', 'ADV-006'),
    ('paid_media', 'ADV-007'),
    ('paid_media', 'ADV-008'),
    ('paid_media', 'ADV-009'),
    ('paid_media', 'ADV-010'),
    ('paid_media', 'ADV-011'),
    ('paid_media', 'ADV-012'),
    ('paid_media', 'ADV-013'),
    ('paid_media', 'ADV-014'),
    ('paid_media', 'ADV-015'),
    ('paid_media', 'AUD-005'),
    ('paid_media', 'CAM-011'),
    ('paid_media', 'CNT-016'),
    ('paid_media', 'DIG-003'),
    ('paid_media', 'DIG-005'),
    ('paid_media', 'DIG-006'),
    ('paid_media', 'DIG-007'),
    ('paid_media', 'DIG-016'),
    ('paid_media', 'DIG-017'),
    ('paid_media', 'ENV-011'),
    ('paid_media', 'ENV-014'),
    ('paid_media', 'MED-001'),
    ('paid_media', 'MED-002'),
    ('paid_media', 'MED-003'),
    ('paid_media', 'MED-004'),
    ('paid_media', 'MED-005'),
    ('paid_media', 'MED-006'),
    ('paid_media', 'VID-014'),
    ('production', 'ADV-010'),
    ('production', 'ADV-011'),
    ('production', 'ADV-012'),
    ('production', 'AUD-001'),
    ('production', 'AUD-003'),
    ('production', 'AUD-004'),
    ('production', 'AUD-005'),
    ('production', 'CNT-017'),
    ('production', 'CNT-018'),
    ('production', 'CNT-019'),
    ('production', 'EVT-012'),
    ('production', 'PHO-001'),
    ('production', 'PHO-002'),
    ('production', 'PHO-003'),
    ('production', 'PHO-004'),
    ('production', 'PHO-005'),
    ('production', 'PHO-006'),
    ('production', 'PHO-007'),
    ('production', 'PHO-008'),
    ('production', 'PHO-009'),
    ('production', 'PHO-011'),
    ('production', 'PHO-012'),
    ('production', 'PHO-013'),
    ('production', 'PHO-014'),
    ('production', 'SOC-004'),
    ('production', 'VID-001'),
    ('production', 'VID-002'),
    ('production', 'VID-003'),
    ('production', 'VID-004'),
    ('production', 'VID-005'),
    ('production', 'VID-006'),
    ('production', 'VID-007'),
    ('production', 'VID-009'),
    ('production', 'VID-010'),
    ('production', 'VID-011'),
    ('production', 'VID-012'),
    ('production', 'VID-014'),
    ('production', 'VID-015'),
    ('production', 'VID-016'),
    ('production', 'VID-017'),
    ('production', 'VID-018'),
    ('production', 'VID-019'),
    ('production', 'VID-021'),
    ('production', 'VID-022'),
    ('production', 'VID-023'),
    ('production', 'VID-024'),
    ('production', 'VID-025'),
    ('single_execution', 'ADV-001'),
    ('single_execution', 'ADV-006'),
    ('single_execution', 'ADV-007'),
    ('single_execution', 'ADV-008'),
    ('single_execution', 'ADV-009'),
    ('single_execution', 'ADV-013'),
    ('single_execution', 'ADV-014'),
    ('single_execution', 'ADV-015'),
    ('single_execution', 'AUD-002'),
    ('single_execution', 'CNT-001'),
    ('single_execution', 'CNT-002'),
    ('single_execution', 'CNT-005'),
    ('single_execution', 'CNT-006'),
    ('single_execution', 'CNT-008'),
    ('single_execution', 'CNT-009'),
    ('single_execution', 'CNT-010'),
    ('single_execution', 'CNT-011'),
    ('single_execution', 'CNT-012'),
    ('single_execution', 'CNT-013'),
    ('single_execution', 'CNT-014'),
    ('single_execution', 'CNT-015'),
    ('single_execution', 'CNT-016'),
    ('single_execution', 'CNT-022'),
    ('single_execution', 'DIG-005'),
    ('single_execution', 'DIG-006'),
    ('single_execution', 'DIG-007'),
    ('single_execution', 'DIG-008'),
    ('single_execution', 'DIG-009'),
    ('single_execution', 'DIG-010'),
    ('single_execution', 'DIG-011'),
    ('single_execution', 'DIG-015'),
    ('single_execution', 'ENV-001'),
    ('single_execution', 'ENV-002'),
    ('single_execution', 'ENV-003'),
    ('single_execution', 'ENV-007'),
    ('single_execution', 'ENV-008'),
    ('single_execution', 'ENV-009'),
    ('single_execution', 'ENV-011'),
    ('single_execution', 'ENV-012'),
    ('single_execution', 'ENV-013'),
    ('single_execution', 'ENV-014'),
    ('single_execution', 'IDN-001'),
    ('single_execution', 'IDN-002'),
    ('single_execution', 'IDN-003'),
    ('single_execution', 'IDN-004'),
    ('single_execution', 'IDN-005'),
    ('single_execution', 'IDN-006'),
    ('single_execution', 'IDN-007'),
    ('single_execution', 'IDN-008'),
    ('single_execution', 'IDN-009'),
    ('single_execution', 'IDN-010'),
    ('single_execution', 'IDN-011'),
    ('single_execution', 'IDN-012'),
    ('single_execution', 'IDN-013'),
    ('single_execution', 'IDN-014'),
    ('single_execution', 'IDN-015'),
    ('single_execution', 'IDN-016'),
    ('single_execution', 'IDN-017'),
    ('single_execution', 'PAC-001'),
    ('single_execution', 'PAC-002'),
    ('single_execution', 'PAC-003'),
    ('single_execution', 'PAC-004'),
    ('single_execution', 'PAC-005'),
    ('single_execution', 'PAC-006'),
    ('single_execution', 'PAC-007'),
    ('single_execution', 'PAC-008'),
    ('single_execution', 'PAC-009'),
    ('single_execution', 'PAC-010'),
    ('single_execution', 'PAC-011'),
    ('single_execution', 'PAC-012'),
    ('single_execution', 'PAC-013'),
    ('single_execution', 'PAC-014'),
    ('single_execution', 'PAC-015'),
    ('single_execution', 'PAC-016'),
    ('single_execution', 'PHO-010'),
    ('single_execution', 'PHO-011'),
    ('single_execution', 'PHO-012'),
    ('single_execution', 'PRE-001'),
    ('single_execution', 'PRE-002'),
    ('single_execution', 'PRE-003'),
    ('single_execution', 'PRE-004'),
    ('single_execution', 'PRE-007'),
    ('single_execution', 'PRE-008'),
    ('single_execution', 'PRE-009'),
    ('single_execution', 'PRE-010'),
    ('single_execution', 'PRT-001'),
    ('single_execution', 'PRT-002'),
    ('single_execution', 'PRT-003'),
    ('single_execution', 'PRT-004'),
    ('single_execution', 'PRT-005'),
    ('single_execution', 'PRT-006'),
    ('single_execution', 'PRT-007'),
    ('single_execution', 'PRT-008'),
    ('single_execution', 'PRT-009'),
    ('single_execution', 'PRT-010'),
    ('single_execution', 'PRT-011'),
    ('single_execution', 'PRT-012'),
    ('single_execution', 'PRT-013'),
    ('single_execution', 'PRT-014'),
    ('single_execution', 'PRT-015'),
    ('single_execution', 'PRT-017'),
    ('single_execution', 'PRT-018'),
    ('single_execution', 'PRT-019'),
    ('single_execution', 'PRT-020'),
    ('single_execution', 'VID-015'),
    ('single_execution', 'VID-016'),
    ('single_execution', 'VID-018'),
    ('single_execution', 'VID-020'),
    ('single_execution', 'VID-021'),
    ('single_execution', 'VID-022'),
    ('single_execution', 'VID-024'),
    ('social_calendar', 'ADV-003'),
    ('social_calendar', 'CAM-010'),
    ('social_calendar', 'CNT-003'),
    ('social_calendar', 'CNT-004'),
    ('social_calendar', 'CNT-011'),
    ('social_calendar', 'CNT-020'),
    ('social_calendar', 'CNT-021'),
    ('social_calendar', 'SOC-001'),
    ('social_calendar', 'SOC-002'),
    ('social_calendar', 'SOC-003'),
    ('social_calendar', 'SOC-004'),
    ('social_calendar', 'SOC-007'),
    ('social_calendar', 'SOC-008'),
    ('social_calendar', 'SOC-010'),
    ('social_calendar', 'SOC-011'),
    ('social_calendar', 'SOC-012'),
    ('social_calendar', 'SOC-013'),
    ('social_calendar', 'SOC-014'),
    ('social_calendar', 'SOC-015'),
    ('social_calendar', 'SOC-016'),
    ('social_calendar', 'SOC-017'),
    ('social_calendar', 'SOC-018'),
    ('social_calendar', 'STR-014'),
    ('social_calendar', 'STR-015'),
    ('social_calendar', 'VID-007'),
    ('social_calendar', 'VID-009'),
    ('social_calendar', 'VID-010'),
    ('social_calendar', 'VID-020')
         ) as m(brief_type, type_code)
    join deliverable_types dt
      on dt.tenant_id = p_tenant and dt.code = m.type_code
  on conflict (tenant_id, brief_type, deliverable_type_id) do nothing;
end $$;

comment on function app.seed_tenant_brief_deliverable_types(uuid) is
  'ADR-0071 d.1: seed the brief-to-deliverable-type mapping accepted on 5 Sep. Idempotent, and it '
  'never removes a row a tenant has added or deleted — this seeds an opinion, it does not enforce '
  'one.';

select app.seed_tenant_brief_deliverable_types(id) from tenants;

commit;
