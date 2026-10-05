-- A required resource is needed for HOURS, not whole days (Edward, 26 Aug).
--
-- WHAT WAS WRONG. `sub_task_resources.days` asked how many DAYS an asset was needed for, and the
-- scheduler therefore booked it for a full standard day each time. A camera wanted for three hours
-- blocked the whole day, and the grid reported the studio as unavailable when it was free from
-- lunchtime — the schedule lying about availability is the one thing it must never do.
--
-- It also contradicted an ADR already on the books. ADR-0006: "hours are the booking vocabulary;
-- load % is derived, never asked." Every other piece of effort on this project is hours —
-- `sub_tasks.sla_hours` is total hours spread across working days by `spreadHours`, and the grid
-- shows hours on every chip. `days` was the only place that broke the vocabulary, and it was mine.
--
-- THE SHAPE now mirrors `sla_hours` exactly: `hours` is the TOTAL the resource is needed for, laid
-- out from `starts_on` (or the task's first day) across consecutive working days, up to a standard
-- day each, until it is used up. 3h is one short booking; 16h is two full days; 20h is 8 + 8 + 4.
-- Nothing about `starts_on`, the unique constraint or the tenant fences changes.
--
-- ADR-0042 d.3 is amended to match. This is a forward fix to 20260826100000, which is already
-- applied — hence a new migration rather than an edit (ADR-0007).
--
-- search_path pinned inline per ADR-0033.

begin;

-- The column is added nullable, backfilled, then made NOT NULL: `days` shipped hours ago and no
-- screen writes to this table yet, so in practice there is nothing to convert — but a migration
-- that assumes an empty table and is wrong about it destroys data, and this one costs nothing.
alter table sub_task_resources add column hours numeric(6,2);

update sub_task_resources set hours = days * 8 where hours is null;

alter table sub_task_resources alter column hours set not null;
alter table sub_task_resources add constraint chk_sub_task_resources_hours check (hours > 0);

alter table sub_task_resources drop column days;

comment on column sub_task_resources.hours is
  'ADR-0042 d.3, amended 26 Aug: TOTAL hours the resource is needed for — not the task''s span, and '
  'not whole days. Laid out from starts_on across consecutive working days, up to a standard day '
  'each. Hours are the booking vocabulary (ADR-0006); load % is derived from this, never asked.';

commit;
