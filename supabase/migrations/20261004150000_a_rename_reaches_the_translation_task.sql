-- ADR-0117 d.4 (I74.37) — a deliverable's rename reaches its translation task.
--
-- Found 4 Oct building I74.35: the translation task reads "Translation — <deliverable> (Arabic, English)" — the
-- name is followed by its languages, not at the end — so the rename rule, which matches the end of a title,
-- left it on the old name. Re-emitted whole from 20261004110000 with that one addition.
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
  -- The translation task names the deliverable before its languages (ADR-0117 d.4):
  -- "Translation — <name> (Arabic, English)". I74.37: it follows a rename too.
  update sub_tasks t
     set title = 'Translation — ' || app.task_segment(new.name)
                 || substr(t.title, length('Translation — ' || p.old_seg) + 1)
    from (select v.seg as old_seg from (values (old.name), (app.task_segment(old.name))) v(seg)) p
   where t.deliverable_id = new.id
     and left(t.title, length('Translation — ' || p.old_seg || ' (')) = 'Translation — ' || p.old_seg || ' (';
  return new;
end $$;

commit;
