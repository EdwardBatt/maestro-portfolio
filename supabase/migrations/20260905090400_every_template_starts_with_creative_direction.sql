-- I38.6 (ADR-0071 d.6) — every template that makes something starts with Creative Direction,
-- then Develop Concept.
--
-- Edward, 5 Sep: *"I would argue that every workflow starts with Creative Direction."*
--
-- **It existed in ONE template of fourteen** — WF-04 Photography. Everywhere else the first thing
-- anybody did was Copy, Concept or Design, with nobody having set the look, tone and approach
-- first. That is not a naming problem; it is a missing piece of work, and the reason it was missing
-- is that the 28 August seed transcribed step lists from a document that assumed the direction had
-- already happened somewhere off-system.
--
-- NEVER PER-UNIT. One direction covers all six reels — it is the opposite of the creation step.
--
-- THREE TEMPLATES DO NOT GET IT, confirmed by Edward:
--   * WF-07 Branding takes it AFTER Strategy (research and strategy precede direction on a branding
--     job) — done in that template's own revision, not here.
--   * WF-17 Media & Performance and WF-19 Strategy Document do not take it at all: a media plan and
--     a written strategy are not art directed.
--
-- HOW THE ORDER IS MADE. `uq_workflow_steps_tenant_template_order` means sort_order cannot simply
-- have 1 inserted in front of it. Existing rows move to `n * 10 + 1000` (1,2,3 -> 1010,1020,1030), the new
-- rows land in the gaps at 1005 and 1006, and then everything is renumbered 1..N by position. A tenant's
-- own added steps ride along untouched and keep their relative order.
--
-- SYSTEM TEMPLATES ONLY, and `on conflict do nothing` on the title: a tenant who has already added
-- their own "Creative Direction" keeps theirs and gets no duplicate.

begin;

create or replace function app.seed_tenant_i38_direction_steps(p_tenant uuid) returns void
language plpgsql as $$
begin
  -- 1) open the gaps
  -- `* 10` ALONE IS A BUG, and an existing test caught it: the unique constraint on
  -- (tenant, template, sort_order) is checked per row, so on a template with ten or more
  -- steps setting row 1 to 10 collides with row 10, which has not moved yet. It happened to
  -- pass for the tenants alive today only because of the order Postgres chose. `+ 1000` puts
  -- every new value above every old one, so no intermediate state can collide.
  update workflow_steps ws set sort_order = ws.sort_order * 10 + 1000
    from workflow_templates wt
   where wt.id = ws.template_id and wt.tenant_id = p_tenant and ws.tenant_id = p_tenant
     and wt.is_system and wt.code in (select distinct code from (values
    ('WF-01', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-01', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-02', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-02', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-03', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-04', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1015),
    ('WF-05', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-05', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-06', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-08', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-09', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-10', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-11', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-11', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-12', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-12', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-13', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-13', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-14', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-14', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006)
       ) as v(code, title_en, title_ar, at)) ;

  -- 2) the new steps, skipped where the tenant already has one by that name
  insert into workflow_steps (tenant_id, template_id, sort_order, title_en, title_ar,
                              repeats_per_unit, review_mode)
  select p_tenant, wt.id, v.at, v.title_en, v.title_ar, false, 'digital'
    from workflow_templates wt
    join (values
    ('WF-01', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-01', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-02', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-02', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-03', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-04', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1015),
    ('WF-05', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-05', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-06', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-08', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-09', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-10', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-11', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-11', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-12', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-12', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-13', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-13', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006),
    ('WF-14', 'Creative Direction', 'التوجيه الإبداعي', 1005),
    ('WF-14', 'Develop Concept', 'تطوير المفهوم الإبداعي', 1006)
         ) as v(code, title_en, title_ar, at) on v.code = wt.code
   where wt.tenant_id = p_tenant and wt.is_system
     and not exists (
       select 1 from workflow_steps x
        where x.template_id = wt.id and x.title_en = v.title_en);

  -- 3) close the gaps again, so the numbers read 1..N
  update workflow_steps ws set sort_order = r.rn
    from (select s.id, row_number() over (partition by s.template_id order by s.sort_order) as rn
            from workflow_steps s
            join workflow_templates t on t.id = s.template_id
           where t.tenant_id = p_tenant and t.is_system) r
   where r.id = ws.id and ws.sort_order is distinct from r.rn;
end $$;

comment on function app.seed_tenant_i38_direction_steps(uuid) is
  'ADR-0071 d.6: put Creative Direction first and Develop Concept second on every seeded template '
  'that makes something. Never per-unit. Skips a template that already has a step by that name, so '
  'a tenant''s own addition is never duplicated.';

select app.seed_tenant_i38_direction_steps(id) from tenants;

commit;
