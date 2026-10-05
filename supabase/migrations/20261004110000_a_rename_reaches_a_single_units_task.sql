-- ADR-0071 addendum d.10a (I74.31) — a deliverable's rename reaches its per-unit tasks when the quantity is 1.
--
-- Found 4 Oct (Edward, testing locally): "Digital banner ×3" was released as "Social Advertisement" and renamed
-- on its panel; three of its tasks followed the rename, but "Create Artwork — Social Advertisement" kept the
-- old name. A step that repeats per unit is named WITHOUT its unit number when the quantity is 1
-- (`materialise_deliverable_workflow`: `repeats_per_unit and v_qty > 1`), yet still carries unit_index 1 — and
-- the rename looked only for "… — <old name> 1". It now also tries the title without the number, and keeps the
-- number exactly when the old title had it. Re-emitted whole from 20260927140000; nothing else changes.
begin;

create or replace function app.tg_deliverable_rename_cascade() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name or coalesce(old.name, '') = '' then
    return new;
  end if;
  -- A title may still end in the old name WITH its count (written before I57.48) or without it, and a
  -- per-unit task carries its unit number only when the quantity was more than one. The longest suffix
  -- that matches wins, so "… — Static Post ×3" is not read as ending in "Static Post".
  update sub_tasks t
     set title = left(t.title, length(t.title) - length(x.suffix)) || ' — ' || app.task_segment(new.name)
                 || case when x.with_unit then ' ' || t.unit_index::text else '' end
    from (select t2.id, m.suffix, m.with_unit
            from sub_tasks t2
            cross join lateral (
              select s.suffix, s.with_unit
                from (values
                  (' — ' || old.name || ' ' || t2.unit_index::text, true),
                  (' — ' || app.task_segment(old.name) || ' ' || t2.unit_index::text, true),
                  (' — ' || old.name, false),
                  (' — ' || app.task_segment(old.name), false)
                ) s(suffix, with_unit)
               where s.suffix is not null
                 and (s.with_unit = false or t2.unit_index is not null)
                 and length(t2.title) > length(s.suffix) and right(t2.title, length(s.suffix)) = s.suffix
               order by length(s.suffix) desc
               limit 1) m
           where t2.deliverable_id = new.id) x
   where x.id = t.id;
  return new;
end $$;

comment on function app.tg_deliverable_rename_cascade() is
  'ADR-0071 addendum d.10a: a deliverable''s rename replaces the deliverable segment of each task '
  'title composed under d.10 (`step — deliverable[ unit]`), without a " ×N" count (I57.48), keeping a '
  'unit number only where the title had one (a quantity of 1 names none, I74.31); hand-edited titles '
  'are left alone.';

-- The tasks already left behind by the old rule: a per-unit task of a quantity-1 deliverable whose title
-- still ends in a type's name is not knowable from here (the old name is gone), so none is rewritten.

commit;
