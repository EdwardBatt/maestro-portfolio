-- The audit log's entity filter comes from the LOG, not from a list somebody typed.
--
-- Edward, 6 Sep: *"the audit log only shows me the last 200 entries, I need a means to filter to
-- different ranges or to scroll through the entries not listed."* The paging half of that is a
-- client change; this is the other half.
--
-- **The filter was a hard-coded array of fourteen table names in `AuditPage.tsx`**, written in
-- August. Seventeen business tables have been created since — `campaign_briefs`, `campaign_concepts`,
-- `brief_templates`, `department_brief_templates`, `deliverable_types`, `workflow_templates`, the
-- asset tables — and none of them can be filtered to. Worse than missing: the screen looks complete,
-- so the absence reads as "nothing happened to briefs" rather than "this list does not mention
-- briefs". A hard-coded list of a moving thing is only ever right on the day it is written.
--
-- SECURITY INVOKER, so the view runs as the caller and `audit_events_admin_select` (`audit:view`)
-- decides visibility exactly as it does for the query beside it. No new reach, and no SECURITY
-- DEFINER to justify under AGENTS.md §6 — the same pattern as
-- `20260905090700_unassigned_work_is_counted_by_campaign.sql`.
--
-- The COUNT rides along because it is free here and answers the question that follows the filter —
-- "is it worth looking at bookings?" — without a second round trip per option.

begin;

create or replace view public.audit_event_entities
with (security_invoker = true) as
  select
    e.tenant_id,
    e.entity,
    count(*)::integer as event_count,
    max(e.created_at) as latest_at
  from audit_events e
  group by e.tenant_id, e.entity;

comment on view public.audit_event_entities is
  'Which entities actually appear in this tenant''s audit log, with how many events and the most '
  'recent. Feeds the filter on Admin -> Audit, which was a hard-coded list of fourteen table names '
  'and had missed every table created since August. SECURITY INVOKER: audit:view still decides who '
  'sees anything.';

grant select on public.audit_event_entities to authenticated;

-- The filter and the range are read together — entity, then newest-first within it. The existing
-- indexes cover one column each (`entity, entity_id` and `created_at`), so a filtered page walks one
-- of them and re-sorts. Cheap at 3.5k rows and not at 3.5m, which this table only goes one way
-- towards.
create index if not exists idx_audit_events_tenant_entity_created
  on audit_events (tenant_id, entity, created_at desc);

create index if not exists idx_audit_events_tenant_created
  on audit_events (tenant_id, created_at desc);

commit;
