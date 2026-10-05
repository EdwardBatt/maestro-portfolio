-- I67.1 (Edward, 30 Sep): "Tasks are still being presenting include the qty from the deliverables e.g. Static Post x 3
-- Translation… A fix was already implemented for this and it is not working on single jobs… the qty defined for
-- deliverable should not be included in the job title."
--
-- I57.48 took the " ×N" count out of task TITLES, and they are clean. But a single job named its DELIVERABLE with the
-- count ("Static Post ×3", I52.1's `deliverableNameFor`), and every screen that shows a task beside its piece — the Team
-- timeline, My Work, the task page, the booking dialog, the Team Member dashboard — printed "Static Post ×3". A campaign
-- piece keeps a clean name and prints "× 3" from `quantity` where deliverables are listed (I53.14). From today a single
-- job does the same (the wizard no longer writes the count); this renames the ones already made.
--
-- 1) `app.single_job_names_drop_their_count()` — every deliverable of a single job whose name ends in " ×N" is renamed
--    to `app.task_segment(name)`. Only single jobs: a campaign piece named "Eid banner 300 × 600" by hand is not touched,
--    and neither is a campaign piece at all. The row's `audit_row_change` trigger records each rename. The rename
--    cascade (ADR-0071 d.10a, I57.48) fires as for any rename and leaves the task titles as they are — they already
--    read without the count; a title hand-edited to something else is not matched and not touched.
--    `tg_deliverable_edit_guard` admits it: a migration has no signed-in caller.
-- 2) It runs once here, saying how many it renamed.

begin;

create or replace function app.single_job_names_drop_their_count()
returns integer
language plpgsql
set search_path = public, app, extensions as $$
declare
  v_renamed integer;
begin
  update deliverables d
     set name = app.task_segment(d.name)
    from streams s
    join campaigns c on c.id = s.campaign_id
   where s.id = d.stream_id
     and c.kind = 'single_job'
     and app.task_segment(d.name) <> btrim(d.name)
     and app.task_segment(d.name) <> '';
  get diagnostics v_renamed = row_count;
  return v_renamed;
end $$;

comment on function app.single_job_names_drop_their_count() is
  'I67.1: renames every single job''s deliverable whose name ends in a " ×N" count to the name without it (the count '
  'stays in `quantity`). Campaign pieces are not touched. Returns how many were renamed. Run once by 20260930100000.';

revoke all on function app.single_job_names_drop_their_count() from public, anon, authenticated;

do $$
declare
  v_renamed integer := app.single_job_names_drop_their_count();
begin
  raise notice 'I67.1: % single-job deliverable(s) renamed without their count', v_renamed;
end $$;

commit;
