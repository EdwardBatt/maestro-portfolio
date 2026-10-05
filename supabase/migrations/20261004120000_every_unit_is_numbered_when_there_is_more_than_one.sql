-- ADR-0071 d.10 (I74.33) — when a deliverable has more than one unit, every per-unit task carries its number,
-- unit 1 included; with one unit, none does.
--
-- Found 4 Oct (Edward, testing locally): "Harbor Line Static Posts" went from 1 to 4 units; units 2–4 came in
-- as "Create Content — Harbor Line Static Posts 2/3/4", but unit 1 kept "Create Content — Harbor Line Static
-- Posts" — it was named while the quantity was 1 (no number), and a quantity change never renamed it. Edward
-- (Q17, C): task names keep the deliverable's name; every unit is numbered when there is more than one.
--
-- A trigger after a quantity change renumbers the per-unit tasks named after the deliverable
-- ("<step> — <name>" or "<step> — <name> <n>"); a hand-named task is left alone. The tasks already left
-- without their number are repaired once.
begin;

create or replace function app.tg_deliverable_units_numbered() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_seg text := app.task_segment(new.name);
begin
  if new.quantity is not distinct from old.quantity or coalesce(v_seg, '') = '' then
    return new;
  end if;
  update sub_tasks t
     set title = left(t.title, length(t.title) - length(m.suffix)) || ' — ' || v_seg
                 || case when new.quantity > 1 then ' ' || t.unit_index::text else '' end
    from (select t2.id, s.suffix
            from sub_tasks t2
            cross join lateral (
              select x.suffix from (values
                (' — ' || v_seg || ' ' || t2.unit_index::text),
                (' — ' || v_seg)
              ) x(suffix)
               where length(t2.title) > length(x.suffix) and right(t2.title, length(x.suffix)) = x.suffix
               order by length(x.suffix) desc
               limit 1) s
           where t2.deliverable_id = new.id and t2.unit_index is not null) m
   where m.id = t.id;
  return new;
end $$;

comment on function app.tg_deliverable_units_numbered() is
  'I74.33 (Edward, 4 Oct): after a quantity change, each per-unit task named after the deliverable reads '
  '"<step> — <name> <n>" when the quantity is above 1, and "<step> — <name>" at 1. Hand-named tasks are left alone.';

drop trigger if exists deliverable_units_numbered on deliverables;
create trigger deliverable_units_numbered
  after update of quantity on deliverables
  for each row execute function app.tg_deliverable_units_numbered();

-- The tasks already left behind: a per-unit task of a deliverable with more than one unit, named after it
-- without its number.
update sub_tasks t
   set title = t.title || ' ' || t.unit_index::text
  from deliverables d
 where t.deliverable_id = d.id
   and d.quantity > 1
   and t.unit_index is not null
   and app.task_segment(d.name) <> ''
   and length(t.title) > length(' — ' || app.task_segment(d.name))
   and right(t.title, length(' — ' || app.task_segment(d.name))) = ' — ' || app.task_segment(d.name);

commit;
