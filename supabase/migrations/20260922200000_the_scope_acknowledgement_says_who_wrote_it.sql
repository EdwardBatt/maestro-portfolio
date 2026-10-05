-- I51.1, on the table 20260922180000 forgot — every tenant-scoped row says who made it and who
-- last changed it.
--
-- `scope_acknowledgements` (SJ-v3-S2, the client's answer to a reduced scope) was created with the
-- tenant tag, RLS and the audit trigger, and WITHOUT `created_by` / `updated_by` and the trigger
-- that fills them. pgTAP 123's first two assertions read the catalogue — every table carrying
-- `tenant_id`, minus the four logs that are themselves the record — so the omission failed CI
-- rather than going unnoticed, which is what that test is for.
--
-- Fixed forward: 20260922180000 is committed and pushed, so it is not edited (AGENTS.md §1).
--
-- The table's own columns already say who RECORDED the answer (`recorded_by`, `recorded_at`) —
-- domain facts about the conversation with the client, written by the account manager and read on
-- the job. These two are the standing ones, stamped by the trigger from the signed-in user and
-- never by the caller (20260916120000). Both are kept: one is evidence, the other is provenance.

begin;

alter table scope_acknowledgements
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

create trigger set_actor_columns
  before insert or update on scope_acknowledgements
  for each row execute function app.set_actor_columns();

comment on column scope_acknowledgements.created_by is
  'I51.1: who wrote this row, stamped from the signed-in user. Distinct from recorded_by, which is '
  'the account manager the job shows as having taken the client''s answer down.';

commit;
