-- I16.2 — a department may use several briefs, and one is chosen per campaign.
--
-- `20260830210000` gave a department ONE template, on the reasoning that a department does one kind
-- of work. Edward, 30 Aug: *"If I assign Creative Brief to Creative, I cannot assign any other brief
-- to Creative."* Which is the whole problem: Creative writes a **Creative Brief** for a 360 campaign
-- and an **Execution Brief** for a single banner. One department, two briefs, depending on the job.
--
-- So availability is many-to-many, and the choice moves to where the job is actually known.
--
-- **WHAT DECIDES WHICH ONE.** `campaign_briefs` allows exactly one brief per department per campaign
-- (`uq_campaign_briefs_campaign_department`), and that stays. When a department has one template
-- available it is used with nobody asked; when it has several, the account manager picks at review,
-- which is the moment the deliverables exist and the kind of work is finally knowable. Edward chose
-- this over writing every applicable brief, and over deriving it from the deliverable type — *"if we
-- need to change it later we change it."*
--
-- The column added yesterday is dropped rather than kept alongside: two homes for one fact is how
-- this project has been bitten twice already (ADR-0037; I12.14), and nothing has been assigned in
-- production yet — the screen shipped hours ago.

begin;

-- ============================================================================
-- 1) the column goes
-- ============================================================================
alter table departments drop constraint if exists fk_departments_brief_template;
drop index if exists idx_departments_brief_template;
alter table departments drop column if exists brief_template_id;

-- ============================================================================
-- 2) which briefs a department may use
-- ============================================================================
create table department_brief_templates (
  tenant_id         uuid not null references tenants(id),
  department_id     uuid not null references departments(id) on delete cascade,
  brief_template_id uuid not null references brief_templates(id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (department_id, brief_template_id)
);

create index idx_department_brief_templates_tenant on department_brief_templates (tenant_id);
create index idx_department_brief_templates_template on department_brief_templates (brief_template_id);

comment on table department_brief_templates is
  'ADR-0048 d.5: which brief templates a department MAY write from. Many-to-many — Creative uses '
  'the Creative Brief for a campaign and the Execution Brief for a single item, and two departments '
  'may share one template. Which of them a given campaign uses is chosen at review, where the '
  'deliverables exist and the kind of work is knowable. Never seeded: no two tenants name their '
  'departments alike.';

-- The tenant fence, both ways. FKs ignore RLS, so a composite FK is the only thing that stops a row
-- pairing this tenant's department with another tenant's template — the same pattern
-- deliverable_types → deliverable_categories uses.
alter table departments
  add constraint uq_departments_tenant_id_id unique (tenant_id, id);

alter table department_brief_templates
  add constraint fk_dbt_department
    foreign key (tenant_id, department_id) references departments (tenant_id, id) on delete cascade,
  add constraint fk_dbt_template
    foreign key (tenant_id, brief_template_id) references brief_templates (tenant_id, id) on delete cascade;

alter table department_brief_templates enable row level security;
alter table department_brief_templates force row level security;

-- Read by everyone in the tenant: the campaign page needs to know which briefs a department may
-- use before it can offer the choice, and that is not administrative information.
create policy dbt_tenant_select on department_brief_templates
  for select to authenticated
  using (tenant_id = app.current_tenant_id());

-- Written by the same authority that edits the templates themselves and the organisation.
create policy dbt_manage_write on department_brief_templates
  for all to authenticated
  using (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'))
  with check (tenant_id = app.current_tenant_id() and app.has_permission('organization', 'manage'));

commit;
