-- I53.7 — ADR-0071 addendum d.10a (Edward, 20 Sep): "When a deliverable is renamed, the rename
-- should cascade to all tasks."
--
-- A task's title is composed at creation as `<step> — <deliverable>[ <unit>]` (ADR-0071 d.10,
-- 20260905090000) and then copied. I52.13 (17 Sep) let a deliverable be renamed and left the
-- titles carrying the old name. Reversed for the deliverable segment only: an AFTER trigger on
-- the rename rewrites, in the same statement, every task of the deliverable whose title still ENDS
-- with ` — <old name>` or ` — <old name> <its unit number>`. A title a person edited by hand to
-- something else does not match and is left alone; the step segment and the unit number are never
-- touched. Whichever door renamed — rename_deliverable, update_campaign_deliverable, a PATCH — the
-- same trigger runs (ADR-0037).
--
-- Additive: a trigger; no row changes until somebody renames.

begin;

create or replace function app.tg_deliverable_rename_cascade() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name or coalesce(old.name, '') = '' then
    return new;
  end if;
  update sub_tasks t
     set title = left(t.title, length(t.title) - length(x.suffix)) || ' — ' || new.name
                 || case when t.unit_index is not null then ' ' || t.unit_index::text else '' end
    from (select t2.id,
                 ' — ' || old.name
                   || case when t2.unit_index is not null then ' ' || t2.unit_index::text else '' end as suffix
            from sub_tasks t2
           where t2.deliverable_id = new.id) x
   where x.id = t.id
     and length(t.title) > length(x.suffix)
     and right(t.title, length(x.suffix)) = x.suffix;
  return new;
end $$;

comment on function app.tg_deliverable_rename_cascade() is
  'ADR-0071 addendum d.10a: a deliverable''s rename replaces the deliverable segment of each task '
  'title composed under d.10 (`step — deliverable[ unit]`); hand-edited titles are left alone.';

drop trigger if exists deliverable_rename_cascade on deliverables;
create trigger deliverable_rename_cascade
  after update of name on deliverables
  for each row execute function app.tg_deliverable_rename_cascade();

commit;
