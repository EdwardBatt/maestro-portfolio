-- I38.4 (ADR-0071 d.4) — the Digital Build brief.
--
-- Website, Website Design, Microsite, App Design, UI Design and UX Design were ordered by NOTHING.
-- Six deliverable types with no brief that commissions them, which is why the first draft of the
-- mapping proposed switching them off. Edward, 5 Sep, chose the other answer: *"3. propose a
-- brief."*
--
-- Thirteen fields in the house style of ADR-0048 d.2 — bilingual, guidance phrased as a QUESTION
-- because that guidance is the model's prompt as much as the person's hint (so editing it changes
-- generated output and is a content change, not copy-editing).
--
-- SHIPS BILINGUAL. Edward, 5 Sep: *"Include the Arabic we will have it checked."* This does not
-- repeat the English-only debt ADR-0051 d.6 recorded and ADR-0048 d.2 carried for four templates —
-- the Arabic is a reviewed first draft, present at seed time rather than promised.
--
-- Idempotent on (tenant_id, brief_type), so a re-run adds it where missing and overwrites nothing.

begin;

create or replace function app.seed_tenant_digital_build_brief(p_tenant uuid) returns void
language plpgsql as $$
begin
  insert into brief_templates (tenant_id, brief_type, fields)
  values (p_tenant, 'digital_build', '[{"key": "background", "en": "BACKGROUND", "ar": "الخلفية", "guidance": "What exists today, and what triggered the need to build or rebuild?", "guidance_ar": "ما الموجود اليوم، وما الذي استدعى البناء أو إعادة البناء؟", "multiline": true}, {"key": "objective", "en": "OBJECTIVE", "ar": "الهدف", "guidance": "One sentence. What must this do for the business?", "guidance_ar": "جملة واحدة. ما الذي يجب أن يحققه هذا للعمل؟", "multiline": true}, {"key": "scope", "en": "SCOPE", "ar": "النطاق", "guidance": "Website, microsite, landing page or app? Name what is OUT of scope too.", "guidance_ar": "موقع إلكتروني، ميني سايت، صفحة هبوط أم تطبيق؟ وحدد ما هو خارج النطاق أيضاً.", "multiline": true}, {"key": "audience", "en": "AUDIENCE", "ar": "الجمهور", "guidance": "Who uses it, on what device, in what situation?", "guidance_ar": "من يستخدمه، وعلى أي جهاز، وفي أي سياق؟", "multiline": true}, {"key": "keyJourneys", "en": "KEY JOURNEYS", "ar": "الرحلات الأساسية", "guidance": "The three things a visitor must be able to do without help.", "guidance_ar": "الأمور الثلاثة التي يجب أن يستطيع الزائر إنجازها دون مساعدة.", "multiline": true}, {"key": "contentSource", "en": "CONTENT & WHO SUPPLIES IT", "ar": "المحتوى ومن يوفره", "guidance": "Copy, images, product data - who provides them and by when?", "guidance_ar": "النصوص والصور وبيانات المنتجات — من يوفرها ومتى؟", "multiline": true}, {"key": "languages", "en": "LANGUAGES & DIRECTION", "ar": "اللغات واتجاه الكتابة", "guidance": "Arabic, English or both. Which leads, and does it need right-to-left?", "guidance_ar": "عربي أم إنجليزي أم كلاهما؟ أيهما يقود، وهل يحتاج اتجاهاً من اليمين إلى اليسار؟", "multiline": true}, {"key": "brandAssets", "en": "BRAND ASSETS", "ar": "أصول العلامة", "guidance": "Guidelines, design system or existing site to work from.", "guidance_ar": "الدليل الإرشادي أو نظام التصميم أو الموقع الحالي الذي ننطلق منه.", "multiline": true}, {"key": "platform", "en": "PLATFORM & INTEGRATIONS", "ar": "المنصة والتكاملات", "guidance": "CMS, hosting, payment, CRM, analytics. Who owns each account?", "guidance_ar": "نظام إدارة المحتوى، الاستضافة، الدفع، إدارة العملاء، التحليلات. ومن يملك كل حساب؟", "multiline": true}, {"key": "phasing", "en": "LAUNCH & PHASING", "ar": "الإطلاق والمراحل", "guidance": "Hard date, soft launch, phases. What must be live first?", "guidance_ar": "موعد نهائي ثابت، إطلاق تجريبي، مراحل. ما الذي يجب أن يكون جاهزاً أولاً؟", "multiline": true}, {"key": "successMeasures", "en": "HOW WE WILL KNOW IT WORKED", "ar": "مقاييس النجاح", "guidance": "Traffic, conversion, speed, task completion. Set targets.", "guidance_ar": "الزيارات، معدل التحويل، السرعة، إتمام المهام. حدد أهدافاً رقمية.", "multiline": true}, {"key": "mandatories", "en": "MANDATORIES & RESTRICTIONS", "ar": "الإلزاميات والقيود", "guidance": "Legal, accessibility, privacy, anything that cannot change.", "guidance_ar": "الشروط القانونية، إتاحة الوصول، الخصوصية، وكل ما لا يمكن تغييره.", "multiline": true}, {"key": "handover", "en": "HANDOVER & MAINTENANCE", "ar": "التسليم والصيانة", "guidance": "Who runs it afterwards, and what training or documentation is needed?", "guidance_ar": "من يديره بعد الإطلاق، وما التدريب أو التوثيق المطلوب؟", "multiline": true}]'::jsonb)
  on conflict (tenant_id, brief_type) do nothing;
end $$;

comment on function app.seed_tenant_digital_build_brief(uuid) is
  'ADR-0071 d.4: the Digital Build brief — 13 bilingual fields for website, microsite and app work, '
  'which no existing brief ordered. Idempotent; never overwrites a tenant''s edits.';

select app.seed_tenant_digital_build_brief(id) from tenants;

commit;
