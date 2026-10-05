-- I38.3 (ADR-0071 d.2) — nine deliverable types are switched OFF. None is deleted.
--
-- Edward, 5 Sep: *"if possible deactivate rather than remove items not used, as the taxonomy is
-- valuable in the long term."* Every row below keeps its code, its category and its history, and
-- Admin can switch any of them back on (ADR-0051 d.3 makes the list a tenant's own).
--
-- SIX resolve duplicate names left open on 29 August. The original taxonomy filed the same thing
-- under two categories, so it appeared TWICE in the picker; the one whose category matches the
-- brief that orders the work is kept.
--
-- THREE are the brand-strategy layer above identity — Brand Strategy, Brand Architecture, Brand
-- Naming — which no brief in the agency's ten orders. Confirmed deliberate by Edward, 5 Sep.
--
-- SAFE FOR LIVE WORK, and this was checked rather than assumed: the wizard filters the PICKER on
-- is_active (BriefWizard.tsx:471), while deliverables-api.ts:146 reads the type name through a LEFT
-- embed with NO active filter — so a deliverable already using one of these still renders its name.
-- Nothing in flight changes.
--
--   SOC-005  Short-form Video       duplicate of VID-009
--   SOC-006  Long-form Video        duplicate of VID-010
--   SOC-009  Social Advertisement   duplicate of ADV-003
--   VID-008  Reel                   duplicate of SOC-004
--   PRT-016  Print Advertisement    duplicate of ADV-001
--   ENV-010  Billboard              duplicate of ADV-006
--   STR-001  Brand Strategy         no brief orders it
--   STR-003  Brand Architecture     no brief orders it
--   STR-004  Brand Naming           no brief orders it
--
-- Runs for every tenant and for future ones, via the amendments wrapper, so a tenant provisioned
-- next month does not arrive with the duplicates this removes.

begin;

create or replace function app.seed_tenant_i38_deactivations(p_tenant uuid) returns void
language plpgsql as $$
begin
  -- `is_active` only where it is still TRUE: a tenant who has deliberately re-enabled one of these
  -- has made a decision, and a seed refresh must not silently reverse it.
  update deliverable_types set is_active = false
   where tenant_id = p_tenant
     and is_active
     and code in ('SOC-005', 'SOC-006', 'SOC-009', 'VID-008', 'PRT-016', 'ENV-010', 'STR-001', 'STR-003', 'STR-004');
end $$;

comment on function app.seed_tenant_i38_deactivations(uuid) is
  'ADR-0071 d.2: switch off the six duplicate names left open on 29 Aug and the three brand-strategy '
  'types no brief orders. Never deletes; never re-disables a row a tenant has turned back on.';

select app.seed_tenant_i38_deactivations(id) from tenants;

commit;
