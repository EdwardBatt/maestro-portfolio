-- Everything is logged — and this time it stays that way.
--
-- Edward, 6 Sep, on finding department brief approvals absent from the audit trail: *"there should
-- be a standing rule in the project that all actions require full audit logging."*
--
-- **What went wrong is not that somebody forgot once.** `20260802103000` attached
-- `app.audit_row_change()` to a hand-written array of 22 tables — correct on 2 August and wrong
-- from the next table onwards. **Seventeen** tenant-scoped business tables have been created since
-- and not one was added to it: the briefs, the templates that write them, the concepts proposed
-- against them, the deliverable taxonomy, the workflow templates, every asset table, attendance,
-- and both settings tables. A list of a moving thing is only ever right on the day it is written,
-- and nothing failed when it stopped being right.
--
-- **The rule is now enforced, not remembered.** `092` asserts that EVERY table carrying `tenant_id`
-- has this trigger, with a short exemption list that has to be argued for in the test itself. A new
-- table without it fails the build. That is the difference between a standing rule and a good
-- intention, and it is the only reason this migration will not be needed again.
--
-- The trigger function is unchanged and already generic: it reads `tenant_id` (or
-- `host_tenant_id`), skips any row it cannot attribute, and uses the row's `id` where there is one —
-- so the composite-key tables here (`department_brief_templates`) log with a null `entity_id` and
-- the payload identifying the row, exactly as `role_grants` has since August.

begin;

do $$
declare t text;
begin
  foreach t in array array[
    -- Campaign briefs and everything that shapes them (ADR-0048, 0050, 0065, 0070, 0071).
    'campaign_briefs', 'campaign_brief_receipts', 'campaign_concepts',
    'brief_templates', 'department_brief_templates', 'brief_deliverable_types',
    -- The taxonomy a brief orders work from (ADR-0051, 0054).
    'deliverable_types', 'deliverable_categories', 'deliverable_attribute_values',
    -- What turns a deliverable into tasks (ADR-0052, 0071).
    'workflow_templates', 'workflow_steps',
    -- Client files (ADR-0022). Every upload, move and delete.
    'assets', 'asset_versions', 'asset_folders', 'asset_references',
    -- Who was at work (ADR-0031), and the tenant's own settings.
    'attendance_days', 'attendance_profiles',
    'tenant_storage_settings', 'tenant_reminder_settings'
  ] loop
    -- Idempotent: this migration exists because a list drifted, so it must not care whether a name
    -- on it was already attached by some other hand.
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_row_change on %I', t);
      execute format(
        'create trigger audit_row_change
           after insert or update or delete on %I
           for each row execute function app.audit_row_change()', t);
    end if;
  end loop;
end $$;

commit;
