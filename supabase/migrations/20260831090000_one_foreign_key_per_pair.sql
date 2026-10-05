-- Fix: `department_brief_templates` declared TWO foreign keys to each of its parents, so every
-- embed through it is ambiguous and PostgREST refuses the query outright.
--
-- **The symptom was the whole Brief templates screen going blank.** `useBriefTemplates` embeds
-- `department_brief_templates(department_id, departments(id, name))`; PostgREST found two candidate
-- relationships between the join table and `departments`, returned 400 for the entire select, and
-- the page rendered an empty list rather than eleven templates. Nothing said why — see the
-- companion change on that screen, which now reports a failed read instead of showing nothing.
--
-- `20260830230000` wrote both an inline `references` on each column AND a composite FK for the
-- tenant fence:
--
--   department_id     uuid not null references departments(id)          -- implicit FK #1
--   ...
--   add constraint fk_dbt_department foreign key (tenant_id, department_id)
--     references departments (tenant_id, id)                            -- FK #2
--
-- The composite one is the one to keep: it is what stops a row pairing this tenant's department
-- with another tenant's template, and FKs ignore RLS so nothing else can enforce that. The inline
-- ones add no protection the composite does not already give — they only add ambiguity.
--
-- **This is the second time in one day.** `20260830210000` did the same to
-- `departments → brief_templates` and was corrected before it shipped. Written down in
-- `docs/memory/traps.md` rather than left to be rediscovered a third time: **a composite tenant
-- fence REPLACES the inline reference, it does not accompany it.**

begin;

alter table department_brief_templates
  drop constraint if exists department_brief_templates_department_id_fkey,
  drop constraint if exists department_brief_templates_brief_template_id_fkey;

-- The composite keys carry `on delete cascade` already, so deleting a department or a template
-- still takes its pairings with it — that behaviour came from the constraints being dropped and
-- has to survive them.

commit;
