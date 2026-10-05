-- SJ-v3 (22 Sep) — a campaign's Library folder follows the campaign's name.
--
-- The folder is named when the campaign row is inserted (`provision_folders_after_campaign_insert`,
-- 20260816120000) and was never renamed after that. Two things now make that a defect rather
-- than a curiosity:
--
--   * The single-job flow creates its draft on the FIRST screen, before the title is typed, under
--     a provisional name ("Northwind Beverages · Execution Brief · 2026-09-22 09:42:17 e1y0"), so
--     the receipt has somewhere to file and the brief somewhere to autosave. Without this, every
--     single job's folder would carry that placeholder for ever.
--   * `update_campaign_draft` has always been able to rename a draft, and a renamed campaign's
--     folder kept the old name — nobody had noticed because the wizard names first and renames
--     rarely.
--
-- One AFTER UPDATE OF name trigger: the system folder of kind `campaign` for this campaign takes
-- the new name. The sibling-uniqueness constraint `uq_asset_folders_sibling (client_id, parent_id,
-- name)` cannot bite on the campaign's own folder because `uq_campaigns_tenant_name` already
-- keeps two campaigns from sharing a name; a person's own folder under the projects root with the
-- same name would — that clash is left to surface as the constraint error it is, not swallowed.

begin;

create or replace function app.tg_campaign_folder_follows_name() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  if new.name is distinct from old.name then
    update asset_folders
       set name = new.name
     where campaign_id = new.id and kind = 'campaign' and is_system;
  end if;
  return new;
end $$;

comment on function app.tg_campaign_folder_follows_name() is
  'SJ-v3 (22 Sep): the campaign''s system folder is renamed with the campaign, so a single job '
  'created under a provisional name (the title is typed a screen later) files under its real one.';

drop trigger if exists campaign_folder_follows_name on campaigns;
create trigger campaign_folder_follows_name
  after update of name on campaigns
  for each row execute function app.tg_campaign_folder_follows_name();

-- Folders that drifted before this existed: any campaign folder whose name is not its campaign's.
update asset_folders f
   set name = c.name
  from campaigns c
 where f.campaign_id = c.id and f.kind = 'campaign' and f.is_system and f.name is distinct from c.name
   and not exists (
     select 1 from asset_folders o
      where o.client_id = f.client_id and o.parent_id = f.parent_id and o.name = c.name and o.id <> f.id
   );

commit;
