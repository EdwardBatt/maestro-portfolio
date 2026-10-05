-- I19.1 (ADR-0052 d.2) — a workflow template is a checklist of work to create. Nothing more.
--
-- It names WORK — "Storyboard", "Prepress", "Rough Cut" — and never a person, a department, a team
-- or a role. That is the whole discipline of this table, and it is what makes seeding it safe when
-- seeding `work_types` was not (ADR-0050): the organisation is derived from whoever a human
-- assigns, at the moment they assign them, and nothing shipped by a vendor gets an opinion about
-- how an agency is structured.
--
-- The reference document's own system principle asks the system to determine "required team roles".
-- This ADR refuses that half deliberately. A template says a shoot needs a Storyboard step; it does
-- not say who draws it.
--
-- DEVIATION FROM ADR-0052 d.2, recorded. That decision says "the seed ships English only, and that
-- is a recorded debt". Edward overruled the identical clause in ADR-0051 d.6 on 28 Aug — "we need
-- to generate both now... better to have it in place now" — and
-- `docs/reference/seed-vocabulary-bilingual.md` already carries the 14 template names and the
-- 67-step glossary in Arabic. Shipping English-only here would recreate the debt he had just
-- refused, in the same change set. The Arabic is machine-generated MSA pending native review, the
-- columns are nullable, and every surface falls back to English.

begin;

create table workflow_templates (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  code           text not null check (length(trim(code)) > 0),
  name_en        text not null check (length(trim(name_en)) > 0),
  name_ar        text,
  description_en text,
  description_ar text,
  -- Marks a seeded row, so a later seed refresh can find its own rows again and the Admin screen
  -- can warn before a tenant edits one.
  is_system      boolean not null default false,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_workflow_templates_tenant_code unique (tenant_id, code)
);
create index idx_workflow_templates_tenant_id on workflow_templates (tenant_id);

alter table workflow_templates enable row level security;
alter table workflow_templates force row level security;

-- Read by every member of the tenant: a picker that cannot read its list cannot render.
create policy workflow_templates_tenant_select on workflow_templates
  for select using (tenant_id = app.current_tenant_id());
create policy workflow_templates_manage_write on workflow_templates
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on workflow_templates
  for each row execute function app.set_updated_at();

-- The tenant fence, same composite-FK pattern as `deliverable_types` -> `deliverable_categories`:
-- a step cannot belong to another tenant's template, and FKs ignore RLS so this is the only thing
-- that can enforce it.
alter table workflow_templates
  add constraint uq_workflow_templates_tenant_id_id unique (tenant_id, id);

create table workflow_steps (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  template_id    uuid not null,
  -- `sort_order`, never `sequence`. `sequence` is a Postgres keyword: legal unquoted, but it reads
  -- as DDL in every query mentioning it and must be quoted the moment anything builds SQL around
  -- it. ADR-0051's tables were reconciled to the same name rather than left to diverge.
  sort_order     integer not null,
  title_en       text not null check (length(trim(title_en)) > 0),
  title_ar       text,
  description_en text,
  description_ar text,
  -- ADR-0052 d.4: a template-sourced ESTIMATE, offered as a prefill when the owner assigns the
  -- task. It is deliberately NOT written into `sub_tasks.sla_hours` at materialisation: that column
  -- is tier 1 of `app.effective_sla` ("manual leaf override — beats everything"), so writing a
  -- template default there would short-circuit every SLA tier beneath it on every materialised
  -- task. It is also read as EFFORT by the scheduler while every SLA tier returns TURNAROUND —
  -- two different quantities in one column, which is its own problem and not this one.
  default_hours  numeric(6,2) check (default_hours is null or default_hours > 0),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint uq_workflow_steps_tenant_template_order unique (tenant_id, template_id, sort_order),
  constraint fk_workflow_steps_template
    foreign key (tenant_id, template_id) references workflow_templates (tenant_id, id)
    on delete cascade
);
create index idx_workflow_steps_tenant_id on workflow_steps (tenant_id);
create index idx_workflow_steps_template on workflow_steps (tenant_id, template_id, sort_order);

alter table workflow_steps enable row level security;
alter table workflow_steps force row level security;

create policy workflow_steps_tenant_select on workflow_steps
  for select using (tenant_id = app.current_tenant_id());
create policy workflow_steps_manage_write on workflow_steps
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

create trigger set_updated_at before update on workflow_steps
  for each row execute function app.set_updated_at();

comment on table workflow_templates is
  'ADR-0052 d.1: an ordered checklist of WORK a deliverable type implies. Names activities, never '
  'people, departments, teams or roles — the organisation is derived from whoever a human assigns.';

-- ------------------------------------------------- discharging ADR-0051 d.15 ----
-- `deliverable_types.default_workflow_template_id` was added by 20260828150000 as a bare uuid with
-- no foreign key, because this table did not exist yet. ADR-0051 d.15 names this migration as the
-- one that adds the constraint, and ADR-0052 d.2 accepts the obligation. Discharged here.
alter table deliverable_types
  add constraint fk_deliverable_types_workflow_template
  foreign key (default_workflow_template_id) references workflow_templates(id);

-- ------------------------------------------------------- the task's two columns ----
-- ADR-0052 d.4. Both nullable: a hand-added task has neither and behaves identically to one this
-- table produced. `workflow_step_id` is what makes re-running a template idempotent (d.6) — it is
-- how the materialiser knows a step already has its task.
alter table sub_tasks
  add column workflow_step_id uuid references workflow_steps(id) on delete set null,
  add column sort_order integer;

create index idx_sub_tasks_workflow_step_id on sub_tasks (workflow_step_id);

comment on column sub_tasks.workflow_step_id is
  'ADR-0052 d.4/d.6: the template step this task came from, or null for a hand-added one. Deleting '
  'the step nulls this rather than the task — the work still exists once somebody is doing it.';
comment on column sub_tasks.sort_order is
  'ADR-0052 d.14: PRESENTATION order only. Resequencing never touches starts_at or due_at — order '
  'is not a schedule, and moving a row must not silently move somebody''s week.';

commit;
