-- I38.7 / I38.8 (ADR-0071 d.7, d.8) — steps are named for what they PRODUCE, and the one step
-- quantity multiplies is marked.
--
-- Edward, 5 Sep: *"the terminology is incorrect and misleading which is not only confusing me, it
-- will confuse all the users ... 1st step is always creative direction, 2nd step is develop
-- concept, 3rd step create the defined content ... in any case the actual creation step is the
-- repeat per unit step."*
--
-- `Copy/Content`, `Creative`, `Design` and `Artwork` are craft labels that never say what they
-- produce, and none of them reads as "this is where the reel gets made". Asked plainly whether
-- Copy/Content was the step where the post is created, the answer was NO — it is the writing, and
-- the thing itself was made one step later under a different name in every template.
--
-- THE RULE THIS ENCODES: exactly one step per template is the creation step, it is named
-- `Create ...`, and it is the only step that repeats per unit. It holds in all fourteen templates
-- here. It is a CONVENTION rather than a CHECK because the new templates break it for good reasons
-- (ADR-0071 d.8): WF-15 repeats five steps because its quantity is CREATORS, WF-19 repeats none.
--
-- THE SAFETY GUARD, reused verbatim from 20260829140000, which removed 57 lifecycle steps under the
-- same rule: `is_system` templates ONLY, matched on template CODE **and exact current title_en**. A
-- step a tenant has renamed does not match and is left exactly as they left it. This corrects our
-- seeding; it does not overrule their decisions (ADR-0051 d.3).
--
-- AND IT CANNOT REACH WORK ALREADY ISSUED. `sub_tasks.title` is COPIED at materialisation, never
-- read through the step (ADR-0059 d.3, ADR-0052 d.14) — so every task on the two live campaigns
-- keeps the name it was given. Asserted, not assumed: supabase/tests/085.

begin;

create or replace function app.seed_tenant_i38_step_names(p_tenant uuid) returns void
language plpgsql as $$
begin
  update workflow_steps ws
     set title_en         = m.new_en,
         title_ar         = coalesce(m.new_ar, ws.title_ar),
         repeats_per_unit = m.is_creation
    from workflow_templates wt,
         (values
    ('WF-01', 'Copy/Content', 'Write Copy', 'كتابة النصوص', false),
    ('WF-01', 'Design', 'Create Artwork', 'تنفيذ العمل الفني', true),
    ('WF-02', 'Copy', 'Write Copy', 'كتابة النصوص', false),
    ('WF-02', 'Creative', 'Create Content', 'إنشاء المحتوى', true),
    ('WF-02', 'Scheduling', 'Schedule', 'الجدولة', false),
    ('WF-03', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-03', 'Script', 'Write Script', 'كتابة السيناريو', false),
    ('WF-03', 'Storyboard', 'Draw Storyboard', 'رسم الستوري بورد', false),
    ('WF-03', 'Edit', 'Create Edit', 'تنفيذ المونتاج', true),
    ('WF-03', 'Sound', 'Mix Sound', 'مزج الصوت', false),
    ('WF-03', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-04', 'Selection', 'Select Shots', 'انتقاء اللقطات', false),
    ('WF-04', 'Retouching', 'Create Final Image', 'إنتاج الصورة النهائية', true),
    ('WF-05', 'Copy', 'Write Copy', 'كتابة النصوص', false),
    ('WF-05', 'Design', 'Create Design', 'تنفيذ التصميم', true),
    ('WF-05', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-06', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-06', 'Design', 'Create Design', 'تنفيذ التصميم', true),
    ('WF-06', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-07', 'Strategy', 'Write Strategy', 'كتابة الاستراتيجية', false),
    ('WF-07', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-07', 'Creative Development', 'Develop Creative', 'التطوير الإبداعي', false),
    ('WF-07', 'Brand System', 'Build Brand System', 'بناء نظام العلامة التجارية', false),
    ('WF-07', 'Guidelines', 'Write Guidelines', 'كتابة الدليل الإرشادي', false),
    ('WF-07', 'Asset Production', 'Produce Assets', 'إنتاج الأصول', false),
    ('WF-08', 'Strategy', 'Write Strategy', 'كتابة الاستراتيجية', false),
    ('WF-08', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-08', 'Key Visual', 'Create Key Visual', 'تنفيذ التصميم الأساسي', false),
    ('WF-08', 'Asset Development', 'Create Asset', 'إنتاج الأصل', true),
    ('WF-08', 'Deployment', 'Deploy', 'النشر', false),
    ('WF-09', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-09', 'Design', 'Create Design', 'تنفيذ التصميم', true),
    ('WF-09', 'Production Specification', 'Write Production Spec', 'كتابة مواصفات الإنتاج', false),
    ('WF-09', 'Installation', 'Install', 'التركيب', false),
    ('WF-09', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-10', 'Concept', 'Develop Concept', 'تطوير المفهوم الإبداعي', false),
    ('WF-10', 'Creative Development', 'Develop Creative', 'التطوير الإبداعي', false),
    ('WF-10', 'Production Planning', 'Plan Production', 'تخطيط الإنتاج', false),
    ('WF-10', 'Post-production', 'Create Cut', 'تنفيذ النسخة', true),
    ('WF-10', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-11', 'Assembly', 'Assemble Cut', 'التجميع الأولي', false),
    ('WF-11', 'Fine Cut', 'Create Fine Cut', 'تنفيذ المونتاج الدقيق', true),
    ('WF-11', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-12', 'Source Assets', 'Gather Source Assets', 'تجميع الأصول المصدرية', false),
    ('WF-12', 'Edit', 'Create Edit', 'تنفيذ المونتاج', true),
    ('WF-12', 'Graphics', 'Add Graphics', 'إضافة الجرافيك', false),
    ('WF-12', 'Captions', 'Add Captions', 'إضافة الترجمة النصية', false),
    ('WF-12', 'Delivery / Scheduling', 'Deliver & Schedule', 'التسليم والجدولة', false),
    ('WF-13', 'Selection', 'Select Shots', 'انتقاء اللقطات', false),
    ('WF-13', 'Retouch', 'Create Final Image', 'إنتاج الصورة النهائية', true),
    ('WF-13', 'Delivery', 'Deliver', 'التسليم', false),
    ('WF-14', 'Adaptation', 'Create Adaptation', 'تنفيذ التكييف', true),
    ('WF-14', 'Copy / Graphics', 'Write Copy & Graphics', 'كتابة النصوص والجرافيك', false),
    ('WF-14', 'Delivery', 'Deliver', 'التسليم', false)
         ) as m(code, old_en, new_en, new_ar, is_creation)
   where wt.id = ws.template_id
     and wt.tenant_id = p_tenant
     and ws.tenant_id = p_tenant
     and wt.is_system
     and wt.code = m.code
     and ws.title_en = m.old_en;
end $$;

comment on function app.seed_tenant_i38_step_names(uuid) is
  'ADR-0071 d.7/d.8: rename the seeded steps so the creation step says so, and mark it as the one '
  'quantity multiplies. SYSTEM templates only, matched on code + exact current title — a step a '
  'tenant has renamed is never touched. Cannot affect work already issued: task titles are copied.';

select app.seed_tenant_i38_step_names(id) from tenants;

commit;
