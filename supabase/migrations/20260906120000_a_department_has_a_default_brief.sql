-- I40.19 — a department's NORMAL brief, so nobody is asked which one on an ordinary campaign.
--
-- **What Edward is remembering, and he is right.** Edward, 6 Sep: *"before all these changes were
-- made, selecting a campaign was automatic… what changed that the system cannot intelligently match
-- the brief required on the basis of the deliverables? this was working in early versions."*
--
-- It was automatic, and here is exactly what changed. `20260830210000` gave a department ONE
-- template, on `departments.brief_template_id`. One value, one answer, nobody asked. Hours later
-- `20260830230000` replaced it with this many-to-many table, because — Edward, 30 Aug — *"if I
-- assign Creative Brief to Creative, I cannot assign any other brief to Creative"*, and Creative
-- writes a Creative Brief for a 360 campaign and an Execution Brief for a single banner. The picker
-- was the price of that, and the same migration records the alternative being weighed and set aside:
-- *"Edward chose this over writing every applicable brief, and over deriving it from the deliverable
-- type — 'if we need to change it later we change it.'"* This is that change.
--
-- **It was never derivation.** Nothing has ever matched a brief to deliverables. The old behaviour
-- was a single stored answer per department, and that is what this restores — as a DEFAULT rather
-- than a limit, so the second brief Creative asked for on 30 Aug stays available.
--
-- **Why not derive it after all.** Measured against the live tenant before writing this, not
-- assumed: TEST CAMPAIGN 23's four Creative deliverables (Campaign Adaptations, Video Cutdown, Brand
-- Film, Content Calendar) match Execution, Social Media and — nothing. One each: a three-way tie in
-- which the right answer, the Creative Brief, scores zero, because `brief_deliverable_types` holds
-- its 17 rows under the reserved key `campaign_360` while the Creative Brief template's type is
-- `360`. ADR-0071 d.1 says in as many words that this mapping SORTS and never decides, and a
-- confidently wrong brief is worse than a question.
--
-- **One default per department, and the database says so.** A partial unique index rather than
-- application care: two defaults is the state that would make the campaign page pick arbitrarily,
-- and arbitrary is the thing this is here to remove.

begin;

alter table department_brief_templates
  add column if not exists is_default boolean not null default false;

comment on column department_brief_templates.is_default is
  'I40.19: the brief this department writes unless somebody says otherwise. Restores the automatic '
  'selection `departments.brief_template_id` gave before 20260830230000 made availability '
  'many-to-many, WITHOUT restoring the limit that made Creative unable to hold a second brief. '
  'At most one per department (uq_dbt_one_default). Null-equivalent — false everywhere — is a legal '
  'state: the campaign page then asks, exactly as it does today.';

-- The invariant, held by Postgres. `where is_default` so the index covers only the rows that matter:
-- a department may have seven available templates and at most one default among them.
create unique index if not exists uq_dbt_one_default
  on department_brief_templates (tenant_id, department_id)
  where is_default;

-- ---------------------------------------------------------------- the backfill ----
-- A department with exactly ONE available template already behaved automatically — the page states
-- it rather than asking (`templateFor`) — so marking it default changes nothing and keeps the two
-- readings of "this department's brief" from disagreeing.
--
-- A department with SEVERAL is deliberately left with none. There is no honest way to guess which of
-- Creative's seven is its normal brief: the old column that would have answered it was dropped by
-- `20260830230000`, and picking alphabetically would be inventing an answer. Those departments
-- carry on asking until somebody ticks one, which is one tick each and then never again.
update department_brief_templates d
   set is_default = true
 where not exists (
   select 1 from department_brief_templates o
    where o.department_id = d.department_id
      and o.brief_template_id <> d.brief_template_id
 )
 and not d.is_default;

-- ---------------------------------------------------------------- setting it ----
-- An RPC rather than two UPDATEs from the client: clearing the old default and setting the new one
-- must be one statement pair inside one transaction, or the partial unique index rejects the second
-- write and leaves the department with none. `security definer` for that atomicity; the permission
-- is checked here explicitly, and it is the same one `dbt_manage_write` requires.
create or replace function public.set_department_default_brief(p_department uuid, p_template uuid)
returns void
language plpgsql
security definer
set search_path = public, app, extensions as $$
declare v_tenant uuid := app.current_tenant_id();
begin
  if not app.has_permission('organization', 'manage') then
    raise exception 'setting a department''s default brief needs organization:manage'
      using errcode = '42501';
  end if;

  -- Clearing is a real request, not a missing argument: a department may go back to being asked.
  update department_brief_templates
     set is_default = false
   where tenant_id = v_tenant and department_id = p_department and is_default;

  if p_template is null then
    return;
  end if;

  -- The template must already be one this department MAY use. Defaulting to a brief it is not
  -- allowed to write would put a name on the campaign page that the generator then refuses.
  update department_brief_templates
     set is_default = true
   where tenant_id = v_tenant
     and department_id = p_department
     and brief_template_id = p_template;

  if not found then
    raise exception 'that brief is not one this department may use'
      using errcode = 'P0002';
  end if;
end $$;

comment on function public.set_department_default_brief(uuid, uuid) is
  'I40.19: mark which of a department''s available briefs it writes by default, or pass null to go '
  'back to being asked. One statement pair in one transaction, because the partial unique index '
  'means the old default must go before the new one lands.';

revoke execute on function public.set_department_default_brief(uuid, uuid) from anon;
grant  execute on function public.set_department_default_brief(uuid, uuid) to authenticated;

commit;
