-- I38.5 (ADR-0071 d.3) — the Branding template makes the identity, item by item.
--
-- Edward, 5 Sep, on the seventeen BRAND IDENTITY types the first draft proposed switching off:
-- *"all of those items are required for brand guidelines... is your recommendation they become
-- tasks under brand guidelines?"* Yes — and it is a better answer than the one I had given, which
-- was to invent an eighteenth brief.
--
-- A logo, a colour palette and a typography system are not seventeen deliverables a client orders
-- separately. They are the CONTENTS of one brand guidelines job. Making them tasks loses nothing:
-- the sub-task is already the unit of work AND of review (ADR-0058), so each still gets its own
-- reviewers, its own versions and its own approval — and the job is signed off when all of them
-- are. What it gains is one thing to track instead of seventeen.
--
-- The 17 types stay ACTIVE (they are not touched by 20260905090100): a logo can still be sold on
-- its own through a Single Execution brief, and then it is a deliverable in its own right. Same
-- item, different size of job.
--
-- TWO THINGS THIS DOES NOT DO, both deliberate:
--
--   * It does NOT mark a creation step. Every other seeded template has exactly one step that
--     quantity multiplies; this one has none, because a brand guidelines job's quantity is always
--     1 and its components are named steps rather than N copies of one. That is the documented
--     exception in ADR-0071 d.8, and it is why 20260905090300 leaves WF-07 out of its marking.
--
--   * It does NOT delete `Build Brand System`, `Write Guidelines` or `Produce Assets`. The accepted
--     mapping sheet ends the template at the components; three seeded steps would have had to be
--     removed to match it exactly. Deleting seeded steps is the one operation here that can strand
--     something, and Edward's standing instruction is to deactivate rather than remove. They stay,
--     after the components, where they still read correctly — assembling the system, writing the
--     document and producing the asset library are real work that happens once the pieces exist.
--     Say the word and a follow-up migration deactivates them; that is a one-line change and this
--     is not the migration to take the risk in.
--
-- Creative Direction goes AFTER Write Strategy here, not first — the confirmed exception (d.6):
-- on a branding job the research and the strategy come before the direction, not after it.

begin;

create or replace function app.seed_tenant_i38_branding_components(p_tenant uuid) returns void
language plpgsql as $$
declare v_template uuid;
begin
  select id into v_template from workflow_templates
   where tenant_id = p_tenant and code = 'WF-07' and is_system;
  if v_template is null then
    return;                      -- a tenant who deleted or replaced WF-07 keeps their decision
  end if;

  -- open the gaps (see 20260905090400 for why sort_order cannot simply be shifted by one)
  -- `* 10` alone collides mid-statement on a template with ten or more steps (the unique
  -- constraint is checked per row); `+ 1000` puts every new value above every old one. See
  -- 20260905090400, where an existing test caught exactly this.
  update workflow_steps set sort_order = sort_order * 10 + 1000
   where tenant_id = p_tenant and template_id = v_template;

  -- Creative Direction, positioned after Write Strategy rather than first (d.6).
  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template,
         coalesce((select ws.sort_order + 1 from workflow_steps ws
                    where ws.template_id = v_template and ws.title_en = 'Write Strategy'), 15),
         'Creative Direction', 'التوجيه الإبداعي', 'digital', false
   where not exists (select 1 from workflow_steps x
                      where x.template_id = v_template and x.title_en = 'Creative Direction');

  -- The identity components, in the order the mapping sheet sets, immediately after Develop
  -- Creative. Not every job needs all of them — the ones a job does not need are deleted before
  -- the campaign is approved, which is what `remove_sub_task` is for (ADR-0052 d.10).
  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              review_mode, repeats_per_unit)
  select p_tenant, v_template,
         coalesce((select ws.sort_order from workflow_steps ws
                    where ws.template_id = v_template and ws.title_en = 'Develop Creative'), 40)
           + g.n,
         g.en, g.ar, 'digital', false
    from (values
      (1, 'Logo',                  'الشعار'),
      (2, 'Logo System',           'نظام الشعار'),
      (3, 'Colour Palette',        'لوحة الألوان'),
      (4, 'Typography System',     'نظام الخطوط'),
      (5, 'Visual Language',       'اللغة البصرية'),
      (6, 'Iconography',           'الأيقونات'),
      (7, 'Photography Direction', 'توجيه التصوير'),
      (8, 'Brand Pattern',         'النقش المميز للعلامة')
    ) as g(n, en, ar)
   where not exists (select 1 from workflow_steps x
                      where x.template_id = v_template and x.title_en = g.en);

  -- close the gaps again so the numbers read 1..N
  update workflow_steps ws set sort_order = r.rn
    from (select s.id, row_number() over (order by s.sort_order) as rn
            from workflow_steps s where s.template_id = v_template) r
   where r.id = ws.id and ws.sort_order is distinct from r.rn;
end $$;

comment on function app.seed_tenant_i38_branding_components(uuid) is
  'ADR-0071 d.3: the 17 BRAND IDENTITY types are the task list of a Brand Guidelines job, so the '
  'Branding template carries the components as steps. No creation step — a branding job''s quantity '
  'is always 1 (d.8''s documented exception). Adds only what is missing; deletes nothing.';

select app.seed_tenant_i38_branding_components(id) from tenants;

commit;
