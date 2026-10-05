-- I38.8 / I38.9 (ADR-0071 d.8, d.9, d.10) — quantity finally produces work.
--
-- **The rule has existed since 28 August and was never built.** ADR-0058 d.9: *"Instagram Reel × 6
-- is ONE deliverable with six sub-tasks."* ADR-0052 (line 222): a template runs once per
-- deliverable, and *"where a step produces N separately reviewed artefacts, that step carries N
-- sub-tasks."* `app.materialise_deliverable_workflow` inserts exactly ONE row per active step and
-- never reads `deliverables.quantity` — nor could it, because nothing said WHICH step repeats.
--
-- ADR-0058 d.5 records the cost: with six sub-tasks under one deliverable, one uploaded file
-- satisfied all six submit gates — "six approvals, five of them of something nobody looked at".
-- The gate was fixed on 28 Aug. The six tasks it assumed have never existed.
--
-- WHAT MAKES ONE `quantity` COLUMN MEAN TWO THINGS. Where a template has a repeating step,
-- `Instagram Reel × 6` is six reviewable artefacts. Where it has none — Print, OOH, Packaging —
-- `Business Card × 500` is one artwork and a print run, which is ADR-0052 d.7 verbatim. The flag is
-- the whole of the difference, and it is why there is no second column.
--
-- NOTHING HERE TOUCHES EXISTING WORK (ADR-0071 d.12). The columns default to today's behaviour, and
-- the materialisation trigger fires only on a deliverable with NO template tasks at all, so no
-- existing deliverable can gain or lose a row. There is no backfill in this file and there must
-- never be one: re-materialising the approved campaign is the one action that could damage live
-- work, and the trigger already refuses it.

begin;

-- ============================================================================
-- 1) which step repeats (ADR-0071 d.8)
-- ============================================================================
-- Default FALSE so every one of the 97 existing rows keeps behaving exactly as it does today. A
-- migration that changed behaviour by default would be indistinguishable from a backfill.
alter table workflow_steps
  add column repeats_per_unit boolean not null default false;

comment on column workflow_steps.repeats_per_unit is
  'ADR-0071 d.8: this step produces ONE separately reviewed artefact per unit of '
  'deliverables.quantity, so materialisation creates that many tasks for it. Every other step gets '
  'one task however large the quantity — which is what lets `Business Card x 500` stay one artwork '
  'and a print run (ADR-0052 d.7) while `Instagram Reel x 6` becomes six reviewable pieces. '
  'CONVENTION, not a constraint: in a content template exactly one step is ticked and it is the '
  '"Create ..." step (Edward, 5 Sep: "the actual creation step is the repeat per unit step"). '
  'WF-15 Influencer Engagement ticks five, because its quantity is CREATORS and outreach, '
  'contracting, briefing, seeding and going live are each per creator. WF-07R and WF-19 tick none, '
  'because their quantity is always 1. A CHECK requiring exactly one would therefore be wrong.';

-- ============================================================================
-- 2) which unit a task is (ADR-0071 d.8)
-- ============================================================================
alter table sub_tasks
  add column unit_index integer
    check (unit_index is null or unit_index >= 1);

comment on column sub_tasks.unit_index is
  'ADR-0071 d.8: which unit of the deliverable''s quantity this task makes — 1..N for a task from a '
  'repeating step, NULL for every other task including every hand-added one. It is what makes six '
  'tasks from one step distinguishable, and what makes re-running materialisation idempotent '
  'rather than duplicating a unit.';

-- ============================================================================
-- 3) never twice — the index ADR-0052 d.4 specified and nobody created
-- ============================================================================
-- **This is not a replacement; it is the first of its kind.** ADR-0052 d.4 called for
-- `uq_sub_tasks_workflow_step (deliverable_id, workflow_step_id)` and said plainly why the
-- materialiser's `where not exists` guard is not enough: *"the index is what makes 'never
-- duplicates' true for a caller that goes round the materialiser."* It was never written.
-- `20260828190000:124` has only the NON-unique `idx_sub_tasks_workflow_step_id`, and no migration
-- since adds a unique one, so that guarantee has been held by application code alone since 28 Aug.
--
-- Harmless while a step produced one task. Load-bearing the moment a step produces six.
--
-- COALESCE, not a bare column list, and the reason is not style. In a unique index NULL is distinct
-- from NULL, so `(deliverable_id, workflow_step_id, unit_index)` would permit unlimited duplicate
-- rows for every NON-repeating step — precisely the case the index exists to protect, and the
-- majority of rows. `coalesce(unit_index, 0)` collapses that to one comparable value. Postgres 15's
-- `nulls not distinct` would do the same thing more legibly; the expression is used because it
-- needs no version assumption from a file that must apply to whatever the hosted project is running.
create unique index uq_sub_tasks_workflow_step_unit
  on sub_tasks (deliverable_id, workflow_step_id, coalesce(unit_index, 0))
  where workflow_step_id is not null;

comment on index uq_sub_tasks_workflow_step_unit is
  'ADR-0071 d.9, discharging ADR-0052 d.4 which specified this index and was never implemented: one '
  'task per (deliverable, step, unit). coalesce(unit_index, 0) because NULL is distinct from NULL '
  'in a unique index, which would have left every non-repeating step unprotected.';

-- ============================================================================
-- 4) the materialiser reads quantity (ADR-0071 d.9, d.10)
-- ============================================================================
-- Reproduced WHOLE from 20260830090000, the house pattern: a bare `create or replace` resets
-- `proconfig` and silently drops the ADR-0033 `search_path` pin.
--
-- Three changes and no others:
--   * `generate_series` over the quantity for a repeating step, 1 for everything else;
--   * `unit_index` written for a repeating step, NULL otherwise;
--   * the title is COMPOSED — step, deliverable, unit number (d.10).
--
-- **Everything ADR-0052 d.4 and ADR-0059 d.3 decided is untouched**: tasks are created `todo`,
-- unassigned, with no reviewers, carrying the deliverable's department, the step's `sort_order` and
-- the step's `review_mode` COPIED rather than read through, and **`sla_hours` still NULL** — never
-- `default_hours`, for the whole chain of reasons in ADR-0052 d.4 (writing it there short-circuits
-- tiers 2..7 of `app.effective_sla` for every materialised task, silently).
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
  select d.tenant_id, d.department_id, d.name, greatest(coalesce(d.quantity, 1), 1),
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
    -- ADR-0071 d.10. The template still never names a deliverable; the name is composed HERE, at
    -- creation, and then copied like every other title — so a template edited in March still
    -- cannot rename a task issued in January (ADR-0052 d.14, ADR-0059 d.3).
    -- Edward, 5 Sep: "descriptive appropriate names for the deliverables e.g. Prepare Static Post".
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
  -- One row for a normal step; `quantity` rows for a repeating one. This is the whole of the
  -- quantity change: everything else in this statement is reproduced unchanged.
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
  'from step, deliverable and unit at creation and copied thereafter. Returns how many were '
  'created. Idempotent on (deliverable, step, unit).';

commit;
