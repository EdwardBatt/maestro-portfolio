-- I57.48 (Edward, 27 Sep): "when the task list is created the qty is included on each task … this is
-- not required and will create confusion. This is what currently displays: Creative Direction —
-- Static Post ×3; it should just be Creative Direction — Static Post." And, asked, option A: the tasks
-- that already exist are renamed too.
--
-- A task's title is composed as `<step> — <deliverable>[ <unit>]` (ADR-0071 d.10). A single job names
-- its deliverable after the type with its count — "Static Post ×3" (I52.1) — so every task copied the
-- count. The DELIVERABLE keeps its name; only the task's deliverable segment leaves out a trailing
-- " ×N". Units still carry their number ("Create Artwork 2"), which is a different thing.
--
-- 1) `app.task_segment(name)` — the deliverable name as a task title shows it.
-- 2) `app.materialise_deliverable_workflow` — reproduced whole from 20260905090000; the only change is
--    that the name goes through `app.task_segment`.
-- 3) `app.tg_deliverable_rename_cascade` — reproduced from 20260920130000; it matches a title ending
--    in the old name with OR without its count, and writes the new name without it. A hand-edited title
--    still matches neither and is left alone.
-- 4) Existing tasks: every title that ends in ` — <its deliverable's name>[ <unit>]` where that name ends
--    in " ×N" loses the " ×N". Hand-edited titles do not match and are not touched. No other column moves.

begin;

-- ============================================================================
-- 1) the deliverable, as a task title names it
-- ============================================================================
create or replace function app.task_segment(p_name text)
returns text
language sql
immutable
as $$
  select regexp_replace(btrim(coalesce(p_name, '')), '\s*×\s*[0-9]+$', '')
$$;

comment on function app.task_segment(text) is
  'I57.48: a deliverable''s name as its tasks'' titles carry it — without a trailing " ×N" count '
  '("Static Post ×3" -> "Static Post"). The deliverable itself keeps the count in its name.';

-- ============================================================================
-- 2) the task list, created — reproduced whole from 20260905090000
-- ============================================================================
create or replace function app.materialise_deliverable_workflow(
  p_deliverable uuid,
  p_template uuid default null
) returns integer
language plpgsql security definer
set search_path = public, app, extensions as $$
declare
  v_tenant   uuid;
  v_dept     uuid;
  v_template uuid;
  v_name     text;
  v_qty      integer;
  v_created  integer;
begin
  select d.tenant_id, d.department_id, app.task_segment(d.name), greatest(coalesce(d.quantity, 1), 1),
         coalesce(p_template, dt.default_workflow_template_id)
    into v_tenant, v_dept, v_name, v_qty, v_template
    from deliverables d
    left join deliverable_types dt on dt.id = d.deliverable_type_id
   where d.id = p_deliverable;

  if v_tenant is null or v_template is null then
    return 0;
  end if;

  if not exists (select 1 from workflow_templates wt
                  where wt.id = v_template and wt.tenant_id = v_tenant) then
    raise exception 'that workflow template is not in your organization' using errcode = '22023';
  end if;

  insert into sub_tasks (
    tenant_id, deliverable_id, title, description, department_id,
    status, sort_order, workflow_step_id, unit_index, review_mode, created_by
  )
  select
    v_tenant,
    p_deliverable,
    -- ADR-0071 d.10, composed here at creation and then copied. I57.48: `v_name` is the deliverable's
    -- name without its " ×N" count.
    ws.title_en
      || case when coalesce(v_name, '') = '' then '' else ' — ' || v_name end
      || case when ws.repeats_per_unit and v_qty > 1 then ' ' || u.n::text else '' end,
    ws.description_en,
    v_dept,
    'todo',
    ws.sort_order,
    ws.id,
    case when ws.repeats_per_unit then u.n else null end,
    ws.review_mode,
    auth.uid()
  from workflow_steps ws
  cross join lateral generate_series(1, case when ws.repeats_per_unit then v_qty else 1 end) as u(n)
  where ws.tenant_id = v_tenant
    and ws.template_id = v_template
    and ws.is_active
    and not exists (
      select 1 from sub_tasks st
       where st.deliverable_id = p_deliverable
         and st.workflow_step_id = ws.id
         and coalesce(st.unit_index, 0)
             = coalesce(case when ws.repeats_per_unit then u.n else null end, 0)
    )
  order by ws.sort_order, u.n;

  get diagnostics v_created = row_count;
  return v_created;
end $$;

comment on function app.materialise_deliverable_workflow(uuid, uuid) is
  'ADR-0052 d.5/d.6, extended by ADR-0059 d.3 and ADR-0071 d.9/d.10: create the unassigned task '
  'list for a deliverable — one task per active step, and `quantity` tasks for a step marked '
  'repeats_per_unit, each carrying its unit number and the step''s review mode. Titles are composed '
  'from step, deliverable (without its " ×N" count, I57.48) and unit at creation and copied '
  'thereafter. Returns how many were created. Idempotent on (deliverable, step, unit).';

-- ============================================================================
-- 3) a rename reaches the tasks — reproduced from 20260920130000
-- ============================================================================
create or replace function app.tg_deliverable_rename_cascade() returns trigger
language plpgsql security definer
set search_path = public, app, extensions as $$
begin
  if new.name is not distinct from old.name or coalesce(old.name, '') = '' then
    return new;
  end if;
  -- A title may still end in the old name WITH its count (written before I57.48) or without it; the
  -- longer suffix is tried first so "… — Static Post ×3" is not read as ending in "Static Post".
  update sub_tasks t
     set title = left(t.title, length(t.title) - length(x.suffix)) || ' — ' || app.task_segment(new.name)
                 || case when t.unit_index is not null then ' ' || t.unit_index::text else '' end
    from (select t2.id,
                 (select s.suffix
                    from (values
                      (' — ' || old.name || case when t2.unit_index is not null then ' ' || t2.unit_index::text else '' end),
                      (' — ' || app.task_segment(old.name) || case when t2.unit_index is not null then ' ' || t2.unit_index::text else '' end)
                    ) s(suffix)
                   where length(t2.title) > length(s.suffix) and right(t2.title, length(s.suffix)) = s.suffix
                   order by length(s.suffix) desc
                   limit 1) as suffix
            from sub_tasks t2
           where t2.deliverable_id = new.id) x
   where x.id = t.id
     and x.suffix is not null;
  return new;
end $$;

comment on function app.tg_deliverable_rename_cascade() is
  'ADR-0071 addendum d.10a: a deliverable''s rename replaces the deliverable segment of each task '
  'title composed under d.10 (`step — deliverable[ unit]`), without a " ×N" count (I57.48); '
  'hand-edited titles are left alone.';

-- ============================================================================
-- 4) the tasks already named with a count
-- ============================================================================
update sub_tasks t
   set title = left(t.title, length(t.title) - length(' — ' || d.name || coalesce(' ' || t.unit_index::text, '')))
               || ' — ' || app.task_segment(d.name) || coalesce(' ' || t.unit_index::text, '')
  from deliverables d
 where t.deliverable_id = d.id
   and app.task_segment(d.name) <> btrim(d.name)
   and length(t.title) > length(' — ' || d.name || coalesce(' ' || t.unit_index::text, ''))
   and right(t.title, length(' — ' || d.name || coalesce(' ' || t.unit_index::text, '')))
       = ' — ' || d.name || coalesce(' ' || t.unit_index::text, '');

commit;
