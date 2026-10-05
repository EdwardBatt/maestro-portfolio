# Seed vocabulary — English / العربية

**What this is.** The bilingual source text for the vocabulary that ADR-0051 and ADR-0052 seed: deliverable categories and types, the six attribute lists, and the workflow templates with their steps. It stands to the Arabic exactly as `docs/reference/Agency Deliverable Taxonomy.md` stands to the English — the reviewable document a migration transcribes, not the migration itself. No code, schema or migration reads this file.

**Which ADRs consume it.**

- **ADR-0051** — `deliverable_categories.name_ar` (§1), `deliverable_types.name_ar` (§2), `deliverable_attribute_values.label_ar` (§3).
- **ADR-0052** — `workflow_templates.name_ar` (§4), `workflow_steps.title_ar` (§5–§6).

Both ADRs recorded English-only seeds with the Arabic as "an outstanding debt". This file discharges that debt in reviewable form, before the seed migrations are written, so the Arabic ships in the same `insert` as the English rather than in a follow-up.

**Date:** 2026-08-28.

> ### ⚠ This is machine-generated Modern Standard Arabic. It has not been reviewed by a native speaker and must not ship until it has.
>
> It was written to the register of `supabase/migrations/20260827200000_brief_templates.sql` — professional agency MSA for Iraq and the Gulf — and it reuses the terms that migration and `src/locales/ar.json` already established (مُخرَج, اعتماد, مراجعة, التسليم, التصميم الأساسي, نبرة الصوت). That makes it consistent, not correct. Trade vocabulary is where machine translation fails quietly: "Prepress", "Rough Cut", "Grade", "Ingest" and "Collateral" are jobs, not dictionary entries, and a wrong one reads as fluent Arabic to anyone who is not in the trade.
>
> **77 of 385 rows are marked ⚠** with a note saying why. Those are the rows where the choice is genuinely open — a term with no settled Arabic, a pair of English entries that would collapse into one Arabic word, or a term the repo already renders two different ways. The remaining 308 are terms I am confident in; they still deserve a read, but the ⚠ rows are the job.

**Conventions used throughout.**

- **File formats and platform names stay in Latin script** — JPG, PNG, MP4, INDD, HTML, PPTX, Instagram, TikTok, LinkedIn, YouTube — because that is what practitioners write. Acronyms that name a medium (OOH, DOOH, POS, UI, UX, TVC) are translated _and_ keep the acronym in brackets, so the picker is searchable in either language.
- **The concept is translated, not the words.** Key Visual → التصميم الأساسي (following `brief_templates.sql`), Grade → تصحيح الألوان, Prepress → ما قبل الطباعة, Rough Cut → المونتاج الأولي, Tone of Voice → نبرة الصوت.
- **One English term, one Arabic term, everywhere.** The step glossary in §5 exists to enforce this: 154 step instances resolve to 67 translated strings.
- **Where two distinct English entries would collapse into one Arabic word**, both are marked ⚠ and the split is stated. Identity/Branding, Artwork/Final Artwork, Revision/Amendments, Poster/Sticker/Label, Announcement/Advertisement and Review/Revision are the six places this happens.

**Section counts.**

| §   | Section                                               | Rows    | Seeds                                   |
| --- | ----------------------------------------------------- | ------- | --------------------------------------- |
| 1   | Categories                                            | 16      | `deliverable_categories.name_ar`        |
| 2   | Deliverable types                                     | 240     | `deliverable_types.name_ar`             |
| 3   | Attribute values                                      | 48      | `deliverable_attribute_values.label_ar` |
| 4   | Workflow template names                               | 14      | `workflow_templates.name_ar`            |
| 5   | Step glossary (deduplicated)                          | 67      | `workflow_steps.title_ar`               |
|     | **Total distinct strings translated**                 | **385** |                                         |
| 6   | Step instances (references into §5, not retranslated) | 154     | 154 seeded `workflow_steps` rows        |

Counted as _seeded rows_ rather than _distinct strings_, the same vocabulary is **472** — because the 154 step rows carry 67 distinct titles between them. Deduplicating those is the point of §5: "Internal Review" is translated once and reused fourteen times, so it cannot drift.

---

## 1. Categories

16 rows. Seeds `deliverable_categories (code, name_en, name_ar)` — ADR-0051 d.5.

| Code  | English             | العربية                         | Notes                                                                                                                                                                                                          |
| ----- | ------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STR` | BRAND STRATEGY      | استراتيجية العلامة التجارية     |                                                                                                                                                                                                                |
| `IDN` | BRAND IDENTITY      | هوية العلامة التجارية           |                                                                                                                                                                                                                |
| `GUI` | BRAND GUIDELINES    | دليل العلامة التجارية           |                                                                                                                                                                                                                |
| `CAM` | CAMPAIGN            | الحملة                          |                                                                                                                                                                                                                |
| `ADV` | ADVERTISING         | الإعلان                         |                                                                                                                                                                                                                |
| `SOC` | SOCIAL MEDIA        | وسائل التواصل الاجتماعي         |                                                                                                                                                                                                                |
| `CNT` | CONTENT             | المحتوى                         |                                                                                                                                                                                                                |
| `VID` | VIDEO & MOTION      | الفيديو والموشن جرافيك          | ⚠ "Motion" here is motion design, not animation (which is VID-015 رسوم متحركة). "موشن جرافيك" is the transliteration practitioners use; a reviewer who prefers pure MSA would write "الفيديو والتصميم الحركي". |
| `PHO` | PHOTOGRAPHY         | التصوير الفوتوغرافي             |                                                                                                                                                                                                                |
| `DIG` | DIGITAL             | الأعمال الرقمية                 |                                                                                                                                                                                                                |
| `PRT` | PRINT               | المطبوعات                       |                                                                                                                                                                                                                |
| `PAC` | PACKAGING           | التغليف                         |                                                                                                                                                                                                                |
| `ENV` | ENVIRONMENTAL / OOH | التصميم البيئي والإعلان الخارجي |                                                                                                                                                                                                                |
| `PRE` | PRESENTATIONS       | العروض التقديمية                |                                                                                                                                                                                                                |
| `MER` | MERCHANDISE         | المنتجات الترويجية              |                                                                                                                                                                                                                |
| `EVT` | EVENTS              | الفعاليات                       |                                                                                                                                                                                                                |

## 2. Deliverable types

240 rows. Seeds `deliverable_types (code, category_code, name_en, name_ar)` — ADR-0051 d.3/d.4. **The code is the key, not the name** (d.4), which is what makes the twelve duplicate names below survivable.

The twelve names that appear under two codes — Campaign Strategy, Print Advertisement, Social Advertisement, Billboard, Reel, Short-form Video, Long-form Video, Newsletter, Label, Bottle, Event Video, Event Branding — are marked on **both** rows. In ten of the twelve the Arabic is identical, because the English is identical and the category is what tells them apart on screen. The two exceptions are Bottle (PAC-007 زجاجة / MER-006 قارورة مياه), where the senses genuinely differ, and Event Branding, which is separated from Event Identity by a house rule rather than by the source.

### STR — BRAND STRATEGY · استراتيجية العلامة التجارية

| Code      | English                       | العربية                         | Notes                                                                                                                                                                                                                                             |
| --------- | ----------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STR-001` | Brand Strategy                | استراتيجية العلامة التجارية     |                                                                                                                                                                                                                                                   |
| `STR-002` | Brand Positioning             | تموضع العلامة التجارية          |                                                                                                                                                                                                                                                   |
| `STR-003` | Brand Architecture            | هيكل العلامة التجارية           |                                                                                                                                                                                                                                                   |
| `STR-004` | Brand Naming                  | تسمية العلامة التجارية          |                                                                                                                                                                                                                                                   |
| `STR-005` | Brand Proposition             | وعد العلامة التجارية            | ⚠ The repo already says "Proposition" two ways: `20260827200000_brief_templates.sql` uses **الوعد**, `src/locales/ar.json` (`campaigns.strategy.proposition`) uses **الطرح**. I followed the migration. Pick one and fix the other.               |
| `STR-006` | Audience / Persona Definition | تحديد الجمهور والشخصيات النمطية |                                                                                                                                                                                                                                                   |
| `STR-007` | Brand Messaging               | رسائل العلامة التجارية          |                                                                                                                                                                                                                                                   |
| `STR-008` | Tone of Voice                 | نبرة الصوت                      |                                                                                                                                                                                                                                                   |
| `STR-009` | Competitive Analysis          | تحليل المنافسين                 |                                                                                                                                                                                                                                                   |
| `STR-010` | Brand Research                | أبحاث العلامة التجارية          |                                                                                                                                                                                                                                                   |
| `STR-011` | Creative Strategy             | الاستراتيجية الإبداعية          |                                                                                                                                                                                                                                                   |
| `STR-012` | Campaign Strategy             | استراتيجية الحملة               | ⚠ Duplicate name. The identical English string is also CAM-001; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |

### IDN — BRAND IDENTITY · هوية العلامة التجارية

| Code      | English               | العربية                     | Notes                                                                                                                                                 |
| --------- | --------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IDN-001` | Brand Identity        | هوية العلامة التجارية       |                                                                                                                                                       |
| `IDN-002` | Logo                  | الشعار                      |                                                                                                                                                       |
| `IDN-003` | Logo System           | نظام الشعار                 |                                                                                                                                                       |
| `IDN-004` | Primary Logo          | الشعار الأساسي              |                                                                                                                                                       |
| `IDN-005` | Secondary Logo        | الشعار الثانوي              |                                                                                                                                                       |
| `IDN-006` | Wordmark              | الشعار الكتابي              |                                                                                                                                                       |
| `IDN-007` | Symbol / Icon         | الرمز / الأيقونة            |                                                                                                                                                       |
| `IDN-008` | Monogram              | المونوغرام                  | ⚠ No settled MSA term. "المونوغرام" is what designers say; "الحرف الرمزي" is a calque that reads like a definition, not a name. Left as the loanword. |
| `IDN-009` | Colour Palette        | لوحة الألوان                |                                                                                                                                                       |
| `IDN-010` | Typography System     | نظام الخطوط                 |                                                                                                                                                       |
| `IDN-011` | Visual Language       | اللغة البصرية               |                                                                                                                                                       |
| `IDN-012` | Graphic Elements      | العناصر الجرافيكية          |                                                                                                                                                       |
| `IDN-013` | Illustration Style    | أسلوب الرسوم التوضيحية      |                                                                                                                                                       |
| `IDN-014` | Iconography           | منظومة الأيقونات            |                                                                                                                                                       |
| `IDN-015` | Photography Direction | توجيه التصوير الفوتوغرافي   |                                                                                                                                                       |
| `IDN-016` | Brand Pattern         | نقش العلامة التجارية        |                                                                                                                                                       |
| `IDN-017` | Brand Asset Library   | مكتبة أصول العلامة التجارية |                                                                                                                                                       |

### GUI — BRAND GUIDELINES · دليل العلامة التجارية

| Code      | English                    | العربية                       | Notes |
| --------- | -------------------------- | ----------------------------- | ----- |
| `GUI-001` | Brand Guidelines           | دليل العلامة التجارية         |       |
| `GUI-002` | Visual Identity Guidelines | دليل الهوية البصرية           |       |
| `GUI-003` | Logo Guidelines            | دليل استخدام الشعار           |       |
| `GUI-004` | Colour Guidelines          | دليل الألوان                  |       |
| `GUI-005` | Typography Guidelines      | دليل الخطوط                   |       |
| `GUI-006` | Photography Guidelines     | دليل التصوير الفوتوغرافي      |       |
| `GUI-007` | Illustration Guidelines    | دليل الرسوم التوضيحية         |       |
| `GUI-008` | Tone of Voice Guidelines   | دليل نبرة الصوت               |       |
| `GUI-009` | Social Media Guidelines    | دليل وسائل التواصل الاجتماعي  |       |
| `GUI-010` | Digital Brand Guidelines   | دليل العلامة التجارية الرقمي  |       |
| `GUI-011` | Brand Usage Guidelines     | دليل استخدام العلامة التجارية |       |
| `GUI-012` | Brand Toolkit              | حقيبة أدوات العلامة التجارية  |       |

### CAM — CAMPAIGN · الحملة

| Code      | English                 | العربية                | Notes                                                                                                                                                                                                                                             |
| --------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CAM-001` | Campaign Strategy       | استراتيجية الحملة      | ⚠ Duplicate name. The identical English string is also STR-012; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `CAM-002` | Campaign Concept        | مفهوم الحملة           |                                                                                                                                                                                                                                                   |
| `CAM-003` | Campaign Big Idea       | الفكرة الكبرى للحملة   |                                                                                                                                                                                                                                                   |
| `CAM-004` | Campaign Key Visual     | التصميم الأساسي للحملة |                                                                                                                                                                                                                                                   |
| `CAM-005` | Campaign Identity       | هوية الحملة            |                                                                                                                                                                                                                                                   |
| `CAM-006` | Campaign Toolkit        | حقيبة أدوات الحملة     |                                                                                                                                                                                                                                                   |
| `CAM-007` | Campaign Messaging      | رسائل الحملة           |                                                                                                                                                                                                                                                   |
| `CAM-008` | Campaign Adaptations    | تكييفات الحملة         |                                                                                                                                                                                                                                                   |
| `CAM-009` | Campaign Launch Assets  | أصول إطلاق الحملة      |                                                                                                                                                                                                                                                   |
| `CAM-010` | Campaign Content Series | سلسلة محتوى الحملة     |                                                                                                                                                                                                                                                   |

### ADV — ADVERTISING · الإعلان

| Code      | English                   | العربية                           | Notes                                                                                                                                                                                                                                             |
| --------- | ------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADV-001` | Print Advertisement       | إعلان مطبوع                       | ⚠ Duplicate name. The identical English string is also PRT-016; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `ADV-002` | Digital Advertisement     | إعلان رقمي                        |                                                                                                                                                                                                                                                   |
| `ADV-003` | Social Advertisement      | إعلان على وسائل التواصل الاجتماعي | ⚠ Duplicate name. The identical English string is also SOC-009; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `ADV-004` | Display Advertisement     | إعلان شبكة العرض                  | ⚠ "Display" has no clean MSA equivalent. Google's Arabic uses "الشبكة الإعلانية / شبكة العرض"; practitioners often just say "الديسبلاي". Kept distinct from DIG-005/DIG-006 (بانر) on purpose.                                                    |
| `ADV-005` | Search Advertisement      | إعلان البحث                       |                                                                                                                                                                                                                                                   |
| `ADV-006` | Billboard                 | لوحة إعلانية                      | ⚠ Duplicate name. The identical English string is also ENV-010; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `ADV-007` | OOH Advertisement         | إعلان خارجي (OOH)                 |                                                                                                                                                                                                                                                   |
| `ADV-008` | DOOH Advertisement        | إعلان خارجي رقمي (DOOH)           | ⚠ Near-duplicate of ENV-014 "Digital OOH" — the two English strings already mean the same thing. Arabic keeps them distinguishable by definiteness only, which is weak. Worth a decision on whether both codes should ship.                       |
| `ADV-009` | Transit Advertisement     | إعلان وسائل النقل                 |                                                                                                                                                                                                                                                   |
| `ADV-010` | Cinema Advertisement      | إعلان سينمائي                     |                                                                                                                                                                                                                                                   |
| `ADV-011` | Radio Advertisement       | إعلان إذاعي                       |                                                                                                                                                                                                                                                   |
| `ADV-012` | TV Advertisement          | إعلان تلفزيوني                    | ⚠ Near-synonym of VID-001 "TVC". `src/locales/ar.json` already renders TVC as "إعلان تلفزيوني" (`campaigns.briefType.production`), so the two collide. I gave VID-001 the Latin acronym to keep them apart; confirm that is the house style.      |
| `ADV-013` | Advertorial               | مقال إعلاني                       |                                                                                                                                                                                                                                                   |
| `ADV-014` | Promotional Advertisement | إعلان ترويجي                      |                                                                                                                                                                                                                                                   |
| `ADV-015` | Retail Advertisement      | إعلان منافذ البيع                 | ⚠ "Retail" is rendered منافذ البيع here and in the `retail` channel value, for consistency. "إعلان التجزئة" is the more literal alternative.                                                                                                      |

### SOC — SOCIAL MEDIA · وسائل التواصل الاجتماعي

| Code      | English                  | العربية                                | Notes                                                                                                                                                                                                                                             |
| --------- | ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOC-001` | Static Post              | منشور ثابت                             |                                                                                                                                                                                                                                                   |
| `SOC-002` | Carousel                 | منشور متعدد الصور                      | ⚠ Matches Instagram's own Arabic UI. Practitioners say "كاروسيل"; if the carousel holds video as well as stills, "منشور متعدد الشرائح" is more accurate.                                                                                          |
| `SOC-003` | Story                    | قصة (Story)                            | ⚠ Instagram's Arabic UI says "قصة"; every practitioner says "ستوري". Pick a house style — this row and SOC-004 should be decided together.                                                                                                        |
| `SOC-004` | Reel                     | ريلز                                   | ⚠ Loanword, matching Instagram's Arabic UI. Also a duplicate name — see VID-008; the category disambiguates.                                                                                                                                      |
| `SOC-005` | Short-form Video         | فيديو قصير                             | ⚠ Duplicate name. The identical English string is also VID-009; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `SOC-006` | Long-form Video          | فيديو طويل                             | ⚠ Duplicate name. The identical English string is also VID-010; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `SOC-007` | Animated Post            | منشور متحرك                            |                                                                                                                                                                                                                                                   |
| `SOC-008` | Social Graphic           | تصميم لوسائل التواصل الاجتماعي         |                                                                                                                                                                                                                                                   |
| `SOC-009` | Social Advertisement     | إعلان على وسائل التواصل الاجتماعي      | ⚠ Duplicate name. The identical English string is also ADV-003; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `SOC-010` | Social Cover             | صورة غلاف الحساب                       |                                                                                                                                                                                                                                                   |
| `SOC-011` | Profile Image            | صورة الملف الشخصي                      |                                                                                                                                                                                                                                                   |
| `SOC-012` | Social Template          | قالب لوسائل التواصل الاجتماعي          |                                                                                                                                                                                                                                                   |
| `SOC-013` | Social Thumbnail         | صورة مصغّرة لوسائل التواصل الاجتماعي   |                                                                                                                                                                                                                                                   |
| `SOC-014` | Social Infographic       | إنفوجرافيك لوسائل التواصل الاجتماعي    |                                                                                                                                                                                                                                                   |
| `SOC-015` | Social Quote Graphic     | تصميم اقتباس                           |                                                                                                                                                                                                                                                   |
| `SOC-016` | Social Announcement      | تنويه على وسائل التواصل الاجتماعي      | ⚠ "Announcement" and "advertisement" both fall to إعلان in Arabic, which would collide with SOC-009. I used تنويه to keep them apart; "منشور إعلاني" would collide.                                                                               |
| `SOC-017` | Social Competition Asset | أصل مسابقة على وسائل التواصل الاجتماعي |                                                                                                                                                                                                                                                   |
| `SOC-018` | Social Campaign Asset    | أصل حملة على وسائل التواصل الاجتماعي   |                                                                                                                                                                                                                                                   |

### CNT — CONTENT · المحتوى

| Code      | English            | العربية                      | Notes                                                                                                                                                                                                                                             |
| --------- | ------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CNT-001` | Blog Article       | مقال مدونة                   |                                                                                                                                                                                                                                                   |
| `CNT-002` | Website Copy       | نصوص الموقع الإلكتروني       |                                                                                                                                                                                                                                                   |
| `CNT-003` | Social Copy        | نصوص وسائل التواصل الاجتماعي |                                                                                                                                                                                                                                                   |
| `CNT-004` | Caption            | تعليق المنشور                |                                                                                                                                                                                                                                                   |
| `CNT-005` | Headline           | العنوان الرئيسي              |                                                                                                                                                                                                                                                   |
| `CNT-006` | Tagline            | العبارة التعريفية            | ⚠ Deliberately not شعار — that is reserved for IDN-002 Logo. A reviewer may prefer "الشعار النصي".                                                                                                                                                |
| `CNT-007` | Campaign Copy      | نصوص الحملة                  |                                                                                                                                                                                                                                                   |
| `CNT-008` | Product Copy       | نصوص المنتج                  |                                                                                                                                                                                                                                                   |
| `CNT-009` | Editorial Content  | محتوى تحريري                 |                                                                                                                                                                                                                                                   |
| `CNT-010` | Long-form Article  | مقال طويل                    |                                                                                                                                                                                                                                                   |
| `CNT-011` | Short-form Content | محتوى قصير                   |                                                                                                                                                                                                                                                   |
| `CNT-012` | Case Study         | دراسة حالة                   |                                                                                                                                                                                                                                                   |
| `CNT-013` | Whitepaper         | ورقة بيضاء                   | ⚠ Established calque, widely understood in Gulf business Arabic, but still a calque. "ورقة بحثية تعريفية" is more explanatory and less recognisable.                                                                                              |
| `CNT-014` | eBook              | كتاب إلكتروني                |                                                                                                                                                                                                                                                   |
| `CNT-015` | Newsletter         | نشرة إخبارية                 | ⚠ Duplicate name. The identical English string is also PRT-009; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `CNT-016` | Email Copy         | نص البريد الإلكتروني         |                                                                                                                                                                                                                                                   |
| `CNT-017` | Script             | السيناريو                    |                                                                                                                                                                                                                                                   |
| `CNT-018` | Voiceover Script   | نص التعليق الصوتي            |                                                                                                                                                                                                                                                   |
| `CNT-019` | Video Concept      | مفهوم الفيديو                |                                                                                                                                                                                                                                                   |
| `CNT-020` | Content Series     | سلسلة محتوى                  |                                                                                                                                                                                                                                                   |

### VID — VIDEO & MOTION · الفيديو والموشن جرافيك

| Code      | English             | العربية                        | Notes                                                                                                                                                                                                                                             |
| --------- | ------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VID-001` | TVC                 | إعلان تلفزيوني (TVC)           | ⚠ See ADV-012. The Latin acronym is retained to keep TVC and "TV Advertisement" distinguishable; the app currently renders TVC as plain "إعلان تلفزيوني".                                                                                         |
| `VID-002` | Brand Film          | فيلم العلامة التجارية          |                                                                                                                                                                                                                                                   |
| `VID-003` | Corporate Video     | فيديو مؤسسي                    |                                                                                                                                                                                                                                                   |
| `VID-004` | Product Video       | فيديو المنتج                   |                                                                                                                                                                                                                                                   |
| `VID-005` | Promotional Video   | فيديو ترويجي                   |                                                                                                                                                                                                                                                   |
| `VID-006` | Explainer Video     | فيديو توضيحي                   |                                                                                                                                                                                                                                                   |
| `VID-007` | Social Video        | فيديو لوسائل التواصل الاجتماعي |                                                                                                                                                                                                                                                   |
| `VID-008` | Reel                | ريلز                           | ⚠ Loanword; duplicate of SOC-004 — the category disambiguates, as in English.                                                                                                                                                                     |
| `VID-009` | Short-form Video    | فيديو قصير                     | ⚠ Duplicate name. The identical English string is also SOC-005; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `VID-010` | Long-form Video     | فيديو طويل                     | ⚠ Duplicate name. The identical English string is also SOC-006; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `VID-011` | Interview           | مقابلة                         |                                                                                                                                                                                                                                                   |
| `VID-012` | Documentary         | فيلم وثائقي                    |                                                                                                                                                                                                                                                   |
| `VID-013` | Event Video         | فيديو الفعالية                 | ⚠ Duplicate name. The identical English string is also EVT-012; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `VID-014` | Video Advertisement | إعلان فيديو                    |                                                                                                                                                                                                                                                   |
| `VID-015` | Animation           | رسوم متحركة                    |                                                                                                                                                                                                                                                   |
| `VID-016` | Motion Graphic      | موشن جرافيك                    | ⚠ Transliteration. "تصميم حركي" is the MSA alternative; the transliteration is what the trade uses and what keeps it distinct from VID-015 رسوم متحركة.                                                                                           |
| `VID-017` | Motion Identity     | الهوية الحركية                 |                                                                                                                                                                                                                                                   |
| `VID-018` | Logo Animation      | تحريك الشعار                   |                                                                                                                                                                                                                                                   |
| `VID-019` | Title Sequence      | تتر البداية                    | ⚠ "تتر" is the standard broadcast term in Egypt/Levant; verify it reads naturally in Iraqi/Gulf agency use. Alternative: "مقدمة العناوين".                                                                                                        |
| `VID-020` | Video Thumbnail     | صورة الفيديو المصغّرة          |                                                                                                                                                                                                                                                   |
| `VID-021` | Video Cutdown       | نسخة مختصرة من الفيديو         |                                                                                                                                                                                                                                                   |
| `VID-022` | Video Adaptation    | تكييف الفيديو                  |                                                                                                                                                                                                                                                   |
| `VID-023` | Video Master        | النسخة الرئيسية للفيديو        |                                                                                                                                                                                                                                                   |

### PHO — PHOTOGRAPHY · التصوير الفوتوغرافي

| Code      | English               | العربية              | Notes                                                                                                                                                               |
| --------- | --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PHO-001` | Campaign Photography  | تصوير الحملة         |                                                                                                                                                                     |
| `PHO-002` | Product Photography   | تصوير المنتجات       |                                                                                                                                                                     |
| `PHO-003` | Lifestyle Photography | تصوير نمط الحياة     |                                                                                                                                                                     |
| `PHO-004` | Corporate Photography | التصوير المؤسسي      |                                                                                                                                                                     |
| `PHO-005` | Portrait Photography  | تصوير البورتريه      |                                                                                                                                                                     |
| `PHO-006` | Event Photography     | تصوير الفعاليات      |                                                                                                                                                                     |
| `PHO-007` | Location Photography  | التصوير في المواقع   |                                                                                                                                                                     |
| `PHO-008` | Food Photography      | تصوير الطعام         |                                                                                                                                                                     |
| `PHO-009` | Fashion Photography   | تصوير الأزياء        |                                                                                                                                                                     |
| `PHO-010` | Stock Image Selection | اختيار الصور الجاهزة | ⚠ "Stock" has no agreed MSA rendering. "الصور الجاهزة" is clear; practitioners say "صور ستوك"; "صور الأرشيف" implies the agency's own archive, which is wrong here. |
| `PHO-011` | Photo Retouching      | تنقيح الصور          |                                                                                                                                                                     |
| `PHO-012` | Photo Manipulation    | معالجة الصور         |                                                                                                                                                                     |
| `PHO-013` | Photo Library         | مكتبة الصور          |                                                                                                                                                                     |
| `PHO-014` | Photography Shoot     | جلسة تصوير           |                                                                                                                                                                     |

### DIG — DIGITAL · الأعمال الرقمية

| Code      | English              | العربية                   | Notes |
| --------- | -------------------- | ------------------------- | ----- |
| `DIG-001` | Website              | موقع إلكتروني             |       |
| `DIG-002` | Website Design       | تصميم موقع إلكتروني       |       |
| `DIG-003` | Landing Page         | صفحة هبوط                 |       |
| `DIG-004` | Microsite            | موقع مصغّر                |       |
| `DIG-005` | Web Banner           | بانر ويب                  |       |
| `DIG-006` | Digital Banner       | بانر رقمي                 |       |
| `DIG-007` | Email Template       | قالب بريد إلكتروني        |       |
| `DIG-008` | Newsletter Template  | قالب نشرة إخبارية         |       |
| `DIG-009` | Digital Brochure     | بروشور رقمي               |       |
| `DIG-010` | Interactive PDF      | ملف PDF تفاعلي            |       |
| `DIG-011` | Digital Presentation | عرض تقديمي رقمي           |       |
| `DIG-012` | App Design           | تصميم تطبيق               |       |
| `DIG-013` | UI Design            | تصميم واجهة المستخدم (UI) |       |
| `DIG-014` | UX Design            | تصميم تجربة المستخدم (UX) |       |
| `DIG-015` | Digital Template     | قالب رقمي                 |       |

### PRT — PRINT · المطبوعات

| Code      | English             | العربية          | Notes                                                                                                                                                                                                                                                                                      |
| --------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PRT-001` | Business Card       | بطاقة عمل        |                                                                                                                                                                                                                                                                                            |
| `PRT-002` | Letterhead          | ورق مراسلات رسمي |                                                                                                                                                                                                                                                                                            |
| `PRT-003` | Envelope            | ظرف              |                                                                                                                                                                                                                                                                                            |
| `PRT-004` | Brochure            | بروشور           |                                                                                                                                                                                                                                                                                            |
| `PRT-005` | Flyer               | فلاير            | ⚠ Loanword. "نشرة دعائية" is the MSA alternative but is easily confused with CNT-015/PRT-009 نشرة إخبارية.                                                                                                                                                                                 |
| `PRT-006` | Poster              | بوستر            | ⚠ Part of a three-way collision: Poster, Sticker (PRT-019) and Label (PRT-020/PAC-011) all reach for ملصق. I gave Poster and Sticker their loanwords and reserved ملصق تعريفي for Label. Decide the set together.                                                                          |
| `PRT-007` | Catalogue           | كتالوج           |                                                                                                                                                                                                                                                                                            |
| `PRT-008` | Magazine            | مجلة             |                                                                                                                                                                                                                                                                                            |
| `PRT-009` | Newsletter          | نشرة إخبارية     | ⚠ Duplicate name. The identical English string is also CNT-015; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side.                                          |
| `PRT-010` | Annual Report       | التقرير السنوي   |                                                                                                                                                                                                                                                                                            |
| `PRT-011` | Presentation Folder | حافظة تعريفية    | ⚠ No settled term. "فولدر تعريفي" is what is spoken; "حافظة مستندات" loses the presentation sense.                                                                                                                                                                                         |
| `PRT-012` | Postcard            | بطاقة بريدية     |                                                                                                                                                                                                                                                                                            |
| `PRT-013` | Invitation          | دعوة             |                                                                                                                                                                                                                                                                                            |
| `PRT-014` | Certificate         | شهادة            |                                                                                                                                                                                                                                                                                            |
| `PRT-015` | Direct Mail         | بريد مباشر       |                                                                                                                                                                                                                                                                                            |
| `PRT-016` | Print Advertisement | إعلان مطبوع      | ⚠ Duplicate name. The identical English string is also ADV-001; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side.                                          |
| `PRT-017` | Menu                | قائمة طعام       | ⚠ Narrowed to food, which is the agency case, but the English is general. "منيو" is what is spoken; "قائمة" alone is too generic in a UI.                                                                                                                                                  |
| `PRT-018` | Calendar            | تقويم            |                                                                                                                                                                                                                                                                                            |
| `PRT-019` | Sticker             | ستيكر            | ⚠ See PRT-006 — part of the ملصق collision. "لاصق" is the MSA alternative.                                                                                                                                                                                                                 |
| `PRT-020` | Label               | ملصق تعريفي      | ⚠ Duplicate name. The identical English string is also PAC-011; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. Also part of the PRT-006 ملصق collision. |

### PAC — PACKAGING · التغليف

| Code      | English              | العربية               | Notes                                                                                                                                                                                                                                             |
| --------- | -------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAC-001` | Packaging Concept    | مفهوم التغليف         |                                                                                                                                                                                                                                                   |
| `PAC-002` | Packaging Design     | تصميم التغليف         |                                                                                                                                                                                                                                                   |
| `PAC-003` | Primary Packaging    | التغليف الأولي        |                                                                                                                                                                                                                                                   |
| `PAC-004` | Secondary Packaging  | التغليف الثانوي       |                                                                                                                                                                                                                                                   |
| `PAC-005` | Tertiary Packaging   | التغليف الثالثي       |                                                                                                                                                                                                                                                   |
| `PAC-006` | Box                  | علبة                  |                                                                                                                                                                                                                                                   |
| `PAC-007` | Bottle               | زجاجة                 | ⚠ Duplicate name with MER-006. Here I split them by sense — زجاجة for the packaging component, قارورة for the branded merchandise bottle — which makes them distinguishable in Arabic but _not_ a literal mirror of the English.                  |
| `PAC-008` | Can                  | علبة معدنية           |                                                                                                                                                                                                                                                   |
| `PAC-009` | Pouch                | كيس مرن               | ⚠ "باوتش" is the trade word. "كيس مرن" is descriptive MSA and keeps it distinct from PAC-010 غلاف.                                                                                                                                                |
| `PAC-010` | Wrapper              | غلاف                  |                                                                                                                                                                                                                                                   |
| `PAC-011` | Label                | ملصق تعريفي           | ⚠ Duplicate name. The identical English string is also PRT-020; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `PAC-012` | Sleeve               | كُم التغليف           | ⚠ "Sleeve" has no standard Arabic in packaging. كُم is the literal anatomy word; a reviewer may prefer "غلاف خارجي منزلق", which is long.                                                                                                         |
| `PAC-013` | Carton               | كرتون                 |                                                                                                                                                                                                                                                   |
| `PAC-014` | Packaging Artwork    | التنفيذ الفني للتغليف |                                                                                                                                                                                                                                                   |
| `PAC-015` | Packaging Adaptation | تكييف التغليف         |                                                                                                                                                                                                                                                   |
| `PAC-016` | Packaging Mockup     | ماكيت التغليف         | ⚠ ماكيت normally means a physical dummy; for a rendered digital mockup "نموذج محاكاة" is more accurate. Both are used.                                                                                                                            |

### ENV — ENVIRONMENTAL / OOH · التصميم البيئي والإعلان الخارجي

| Code      | English                | العربية                       | Notes                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------- | ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENV-001` | Signage                | اللافتات                      |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-002` | Wayfinding             | لوحات الإرشاد والتوجيه        |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-003` | Retail Graphics        | جرافيك منافذ البيع            |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-004` | Store Branding         | تطبيقات هوية المتجر           |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-005` | Exhibition Graphics    | جرافيك المعارض                |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-006` | Event Branding         | تطبيقات هوية الفعالية         | ⚠ Duplicate name. The identical English string is also EVT-010; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. Note the house rule applied here: **Identity = الهوية, Branding = تطبيقات الهوية** — which is what keeps this row distinct from EVT-002 Event Identity. |
| `ENV-007` | Wall Graphic           | جرافيك جداري                  |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-008` | Window Graphic         | جرافيك الواجهات الزجاجية      |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-009` | Vehicle Graphics       | جرافيك المركبات               |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-010` | Billboard              | لوحة إعلانية                  | ⚠ Duplicate name. The identical English string is also ADV-006; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side.                                                                                                                                                         |
| `ENV-011` | Street Furniture       | أثاث الشوارع الإعلاني         | ⚠ Direct calque. The OOH trade in the region mostly says "ستريت فرنيتشر" or names the format (mupi, kiosk). Added "الإعلاني" so it does not read as municipal benches.                                                                                                                                                                                                                                    |
| `ENV-012` | POS Display            | معروضة نقاط البيع (POS)       | ⚠ "ستاند نقاط البيع" is what is spoken. Kept the Latin POS acronym because ENV-013 relies on the same abbreviation.                                                                                                                                                                                                                                                                                       |
| `ENV-013` | POS Material           | مواد نقاط البيع (POS)         |                                                                                                                                                                                                                                                                                                                                                                                                           |
| `ENV-014` | Digital OOH            | الإعلان الخارجي الرقمي (DOOH) | ⚠ See ADV-008 — the two English entries are already synonyms, and Arabic only separates them by definiteness. Needs a decision on whether both codes ship.                                                                                                                                                                                                                                                |
| `ENV-015` | Environmental Branding | تطبيقات الهوية في المساحات    | ⚠ "Environmental" in the design sense (spatial), not ecological — a real trap, since "البيئي" alone reads as environmentalism in Arabic. Rendered as spatial to avoid it.                                                                                                                                                                                                                                 |

### PRE — PRESENTATIONS · العروض التقديمية

| Code      | English                 | العربية                | Notes                                                                                                                                                                     |
| --------- | ----------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PRE-001` | Pitch Deck              | عرض المنافسة           | ⚠ Everyone says "البيتش". "عرض المنافسة" is accurate for the agency-pitch sense but would be wrong if the tenant uses it for investor pitches — PRE-009 covers that case. |
| `PRE-002` | Sales Deck              | عرض المبيعات           |                                                                                                                                                                           |
| `PRE-003` | Corporate Presentation  | العرض التقديمي المؤسسي |                                                                                                                                                                           |
| `PRE-004` | Brand Presentation      | عرض العلامة التجارية   |                                                                                                                                                                           |
| `PRE-005` | Strategy Presentation   | عرض الاستراتيجية       |                                                                                                                                                                           |
| `PRE-006` | Campaign Presentation   | عرض الحملة             |                                                                                                                                                                           |
| `PRE-007` | Proposal                | المقترح                |                                                                                                                                                                           |
| `PRE-008` | Case Study Presentation | عرض دراسة الحالة       |                                                                                                                                                                           |
| `PRE-009` | Investor Presentation   | عرض المستثمرين         |                                                                                                                                                                           |
| `PRE-010` | Internal Presentation   | عرض داخلي              |                                                                                                                                                                           |

### MER — MERCHANDISE · المنتجات الترويجية

| Code      | English               | العربية                      | Notes                                                                                                                                                              |
| --------- | --------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MER-001` | T-Shirt               | تي شيرت                      |                                                                                                                                                                    |
| `MER-002` | Uniform               | زي موحّد                     |                                                                                                                                                                    |
| `MER-003` | Cap                   | قبعة                         |                                                                                                                                                                    |
| `MER-004` | Bag                   | حقيبة                        |                                                                                                                                                                    |
| `MER-005` | Mug                   | كوب                          |                                                                                                                                                                    |
| `MER-006` | Bottle                | قارورة مياه                  | ⚠ Duplicate name with PAC-007 — split by sense (see that row). "قارورة مياه" narrows the English "Bottle", which is a deliberate trade-off for distinguishability. |
| `MER-007` | Stationery            | قرطاسية                      |                                                                                                                                                                    |
| `MER-008` | Promotional Item      | قطعة ترويجية                 |                                                                                                                                                                    |
| `MER-009` | Corporate Gift        | هدية مؤسسية                  |                                                                                                                                                                    |
| `MER-010` | Branded Merchandise   | منتجات تحمل العلامة التجارية |                                                                                                                                                                    |
| `MER-011` | Merchandise Packaging | تغليف المنتجات الترويجية     |                                                                                                                                                                    |

### EVT — EVENTS · الفعاليات

| Code      | English          | العربية                  | Notes                                                                                                                                                                                                                                             |
| --------- | ---------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EVT-001` | Event Concept    | مفهوم الفعالية           |                                                                                                                                                                                                                                                   |
| `EVT-002` | Event Identity   | هوية الفعالية            | ⚠ Distinguished from EVT-010/ENV-006 "Event Branding" by the house rule **Identity = الهوية, Branding = تطبيقات الهوية**. Confirm that rule before it is applied across the seed.                                                                 |
| `EVT-003` | Event Key Visual | التصميم الأساسي للفعالية |                                                                                                                                                                                                                                                   |
| `EVT-004` | Event Invitation | دعوة الفعالية            |                                                                                                                                                                                                                                                   |
| `EVT-005` | Event Signage    | لافتات الفعالية          |                                                                                                                                                                                                                                                   |
| `EVT-006` | Stage Graphics   | جرافيك المسرح            |                                                                                                                                                                                                                                                   |
| `EVT-007` | Screen Content   | محتوى الشاشات            |                                                                                                                                                                                                                                                   |
| `EVT-008` | Event Programme  | برنامج الفعالية          |                                                                                                                                                                                                                                                   |
| `EVT-009` | Event Collateral | المواد المساندة للفعالية | ⚠ "Collateral" is an agency term with no MSA equivalent. "المواد المساندة" is a description, not a name; "مطبوعات الفعالية" is narrower but reads better.                                                                                         |
| `EVT-010` | Event Branding   | تطبيقات هوية الفعالية    | ⚠ Duplicate name. The identical English string is also ENV-006; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |
| `EVT-011` | Exhibition Stand | جناح المعرض              |                                                                                                                                                                                                                                                   |
| `EVT-012` | Event Video      | فيديو الفعالية           | ⚠ Duplicate name. The identical English string is also VID-013; the Arabic is identical too, so the **category is what disambiguates — in Arabic exactly as in English**. Decision for the reviewer: accept that, or add a qualifier to one side. |

## 3. Attribute values

48 rows across six attributes. Seeds `deliverable_attribute_values (attribute, code, label_en, label_ar)` — ADR-0051 d.10.

**The `code` column below is a suggestion, not a quotation.** ADR-0051 d.10 lists the seeded _values_ but never fixes their codes; the migration author chooses them. Only the English and Arabic are load-bearing here.

### `format` — Format

**Not translated, by rule.** File formats are written in Latin script by every practitioner; transliterating them ("جي بي جي") would make the picker unusable. `label_ar` is the same token as `label_en`.

| Code   | English | العربية | Notes |
| ------ | ------- | ------- | ----- |
| `JPG`  | JPG     | JPG     |       |
| `PNG`  | PNG     | PNG     |       |
| `SVG`  | SVG     | SVG     |       |
| `PDF`  | PDF     | PDF     |       |
| `AI`   | AI      | AI      |       |
| `EPS`  | EPS     | EPS     |       |
| `PSD`  | PSD     | PSD     |       |
| `INDD` | INDD    | INDD    |       |
| `MP4`  | MP4     | MP4     |       |
| `MOV`  | MOV     | MOV     |       |
| `HTML` | HTML    | HTML    |       |
| `PPTX` | PPTX    | PPTX    |       |

### `channel` — Channel

Platform names stay in Latin script, by rule. The rest are translated.

| Code        | English   | العربية                       | Notes                                                                                                                                                                                          |
| ----------- | --------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INSTAGRAM` | Instagram | Instagram                     |                                                                                                                                                                                                |
| `FACEBOOK`  | Facebook  | Facebook                      |                                                                                                                                                                                                |
| `TIKTOK`    | TikTok    | TikTok                        |                                                                                                                                                                                                |
| `YOUTUBE`   | YouTube   | YouTube                       |                                                                                                                                                                                                |
| `LINKEDIN`  | LinkedIn  | LinkedIn                      |                                                                                                                                                                                                |
| `WEBSITE`   | Website   | الموقع الإلكتروني             |                                                                                                                                                                                                |
| `EMAIL`     | Email     | البريد الإلكتروني             |                                                                                                                                                                                                |
| `TV`        | TV        | التلفزيون                     |                                                                                                                                                                                                |
| `RADIO`     | Radio     | الإذاعة                       |                                                                                                                                                                                                |
| `PRINT`     | Print     | المطبوعات                     | ⚠ "Print" appears in two attributes. As a **channel** it is the printed press, so المطبوعات. As a **production type** it is the act of printing, so الطباعة. Deliberate, and worth confirming. |
| `OOH`       | OOH       | الإعلان الخارجي (OOH)         |                                                                                                                                                                                                |
| `DOOH`      | DOOH      | الإعلان الخارجي الرقمي (DOOH) |                                                                                                                                                                                                |
| `RETAIL`    | Retail    | منافذ البيع                   |                                                                                                                                                                                                |
| `EVENT`     | Event     | الفعاليات                     |                                                                                                                                                                                                |

### `orientation` — Orientation

| Code        | English   | العربية   | Notes |
| ----------- | --------- | --------- | ----- |
| `PORTRAIT`  | Portrait  | عمودي     |       |
| `LANDSCAPE` | Landscape | أفقي      |       |
| `SQUARE`    | Square    | مربع      |       |
| `CUSTOM`    | Custom    | مقاس مخصص |       |

### `production_type` — Production Type

| Code           | English             | العربية         | Notes                                                                       |
| -------------- | ------------------- | --------------- | --------------------------------------------------------------------------- |
| `DIGITAL`      | Digital             | رقمي            |                                                                             |
| `PRINT`        | Print               | طباعة           | ⚠ See the `channel` PRINT row — same English, different Arabic, on purpose. |
| `PHYSICAL`     | Physical Production | إنتاج مادي      |                                                                             |
| `VIDEO`        | Video Production    | إنتاج فيديو     |                                                                             |
| `PHOTOGRAPHY`  | Photography         | تصوير فوتوغرافي |                                                                             |
| `AUDIO`        | Audio               | صوتي            |                                                                             |
| `INSTALLATION` | Installation        | تركيب           |                                                                             |
| `HYBRID`       | Hybrid              | مختلط           |                                                                             |

### `complexity` — Complexity

| Code       | English          | العربية    | Notes                                                                                                                                      |
| ---------- | ---------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `SIMPLE`   | Simple           | بسيط       |                                                                                                                                            |
| `STANDARD` | Standard         | قياسي      |                                                                                                                                            |
| `COMPLEX`  | Complex          | معقّد      |                                                                                                                                            |
| `MAJOR`    | Major Production | إنتاج كبير | ⚠ This is a scale label, not a description. "إنتاج ضخم" carries the sense better in the region; "إنتاج كبير" is the safer literal reading. |

### `client_approval` — Client Approval

These four map onto vocabulary the app already ships: `deliverables.action.approve` = اعتماد, `deliverables.colState` in_review = قيد المراجعة.

| Code              | English             | العربية                 | Notes |
| ----------------- | ------------------- | ----------------------- | ----- |
| `NOT_REQUIRED`    | Not Required        | غير مطلوب               |       |
| `INTERNAL_ONLY`   | Internal Only       | داخلي فقط               |       |
| `CLIENT_REVIEW`   | Client Review       | مراجعة العميل           |       |
| `CLIENT_APPROVAL` | Client Approval     | اعتماد العميل           |       |
| `LEGAL`           | Legal Approval      | اعتماد قانوني           |       |
| `REGULATORY`      | Regulatory Approval | اعتماد الجهات التنظيمية |       |

## 4. Workflow template names

14 rows. Seeds `workflow_templates (code, name_en, name_ar)` — ADR-0052 d.2/d.3. Descriptions (`description_en`/`description_ar`) are not translated here: neither source document supplies them.

| Code    | English                       | العربية                            | Source                                         | Steps | Notes                                                                                                                                                                                                                                                                                       |
| ------- | ----------------------------- | ---------------------------------- | ---------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WF-01` | Standard Digital              | المسار الرقمي القياسي              | Agency Deliverable Taxonomy                    | 8     |                                                                                                                                                                                                                                                                                             |
| `WF-02` | Social Content                | محتوى وسائل التواصل الاجتماعي      | Agency Deliverable Taxonomy                    | 8     |                                                                                                                                                                                                                                                                                             |
| `WF-03` | Video Production              | إنتاج الفيديو                      | Agency Deliverable Taxonomy                    | 14    |                                                                                                                                                                                                                                                                                             |
| `WF-04` | Photography                   | التصوير الفوتوغرافي                | Agency Deliverable Taxonomy                    | 9     | ⚠ Same name as WF-13, which ADR-0052 d.3 keeps as a separate template. The English collides too; in Arabic I qualified WF-13, not this one.                                                                                                                                                 |
| `WF-05` | Print                         | الطباعة                            | Agency Deliverable Taxonomy                    | 11    |                                                                                                                                                                                                                                                                                             |
| `WF-06` | Packaging                     | التغليف                            | Agency Deliverable Taxonomy                    | 11    |                                                                                                                                                                                                                                                                                             |
| `WF-07` | Branding                      | بناء العلامة التجارية              | Agency Deliverable Taxonomy                    | 12    |                                                                                                                                                                                                                                                                                             |
| `WF-08` | Campaign                      | الحملة                             | Agency Deliverable Taxonomy                    | 11    |                                                                                                                                                                                                                                                                                             |
| `WF-09` | OOH / Environmental           | الإعلان الخارجي والتصميم البيئي    | Agency Deliverable Taxonomy                    | 11    |                                                                                                                                                                                                                                                                                             |
| `WF-10` | Long-form Physical Production | الإنتاج المادي المطوّل             | Agency Deliverable Taxonomy                    | 12    | ⚠ "Long-form" modifies the _process_, not the content, unlike WF-11. "المطوّل" carries duration; "طويل الأمد" implies a long-running programme, which is wrong.                                                                                                                             |
| `WF-11` | Long Form                     | المحتوى الطويل                     | Production Traffic & Asset Management Model §4 | 16    | ⚠ Code suggested, not fixed. The production model gives these four templates no codes; ADR-0052 d.3 counts them but does not name them. WF-11…WF-14 are my numbering.                                                                                                                       |
| `WF-12` | Short Form                    | المحتوى القصير                     | Production Traffic & Asset Management Model §4 | 11    | ⚠ Code suggested — see WF-11.                                                                                                                                                                                                                                                               |
| `WF-13` | Photography                   | التصوير الفوتوغرافي — مسار الإنتاج | Production Traffic & Asset Management Model §4 | 12    | ⚠ Code suggested — see WF-11. **And a name collision with WF-04**: both are called "Photography" in English. I qualified the Arabic ("— مسار الإنتاج") because this is the version that tracks physical media and ingest. Either qualify the English the same way, or accept the collision. |
| `WF-14` | Adaptation / Versioning       | التكييف وإصدار النسخ               | Production Traffic & Asset Management Model §4 | 8     | ⚠ Code suggested — see WF-11.                                                                                                                                                                                                                                                               |

Step instances: 154 — matching ADR-0052 d.3's count of 154 seeded `workflow_steps` rows per tenant (107 from the taxonomy + 47 from the production model).

## 5. Step glossary — deduplicated

67 distinct step names across the 154 step instances. **Translate once here; every template in §6 references this table.** "Internal Review" is المراجعة الداخلية in all fourteen templates because it is one row here, not fourteen.

| Step (EN)                | العربية                  | Notes                                                                                                                                                                                                                                                                                              |
| ------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Brief                    | البريف                   | ⚠ The app says this two ways today: `campaigns.page.masterBrief` and `admin.briefTemplates.*` use **البريف**, while `campaigns.newBrief` / `colBriefType` use **موجز**. I followed the majority (البريف). This should be settled once, for the app and this seed together.                         |
| Copy/Content             | النصوص والمحتوى          |                                                                                                                                                                                                                                                                                                    |
| Design                   | التصميم                  |                                                                                                                                                                                                                                                                                                    |
| Internal Review          | المراجعة الداخلية        |                                                                                                                                                                                                                                                                                                    |
| Client Review            | مراجعة العميل            |                                                                                                                                                                                                                                                                                                    |
| Revision                 | التعديل                  | ⚠ "Revision" and "Amendments" both fall to تعديل. I used التعديل (singular, the act) here and تنفيذ الملاحظات for Amendments. Note `deliverables.colRevision` in the app already renders "Revision" as المراجعة, which collides with "Review" — that is an existing bug this seed should not copy. |
| Approval                 | الاعتماد                 |                                                                                                                                                                                                                                                                                                    |
| Final                    | النسخة النهائية          |                                                                                                                                                                                                                                                                                                    |
| Copy                     | النصوص                   |                                                                                                                                                                                                                                                                                                    |
| Creative                 | العمل الإبداعي           | ⚠ "Creative" as a noun (the work itself) has no one-word Arabic. "العمل الإبداعي" is safe; "الأعمال الإبداعية" if the step covers several pieces.                                                                                                                                                  |
| Scheduling               | الجدولة                  |                                                                                                                                                                                                                                                                                                    |
| Concept                  | المفهوم الإبداعي         |                                                                                                                                                                                                                                                                                                    |
| Script                   | السيناريو                |                                                                                                                                                                                                                                                                                                    |
| Storyboard               | الستوري بورد             | ⚠ Transliteration, which is universal in the trade. MSA alternatives — "اللوحة القصصية", "المخطط المصوّر" — are correct but not what anyone says on a shoot.                                                                                                                                       |
| Pre-production           | ما قبل الإنتاج           |                                                                                                                                                                                                                                                                                                    |
| Production               | الإنتاج                  |                                                                                                                                                                                                                                                                                                    |
| Edit                     | المونتاج                 |                                                                                                                                                                                                                                                                                                    |
| Sound                    | معالجة الصوت             | ⚠ The step covers sound design and mix. "الصوت" alone is too bare for a checklist item; "المكساج" is the spoken term but narrower.                                                                                                                                                                 |
| Grade                    | تصحيح الألوان            |                                                                                                                                                                                                                                                                                                    |
| Master                   | النسخة الرئيسية          |                                                                                                                                                                                                                                                                                                    |
| Delivery                 | التسليم                  |                                                                                                                                                                                                                                                                                                    |
| Creative Direction       | التوجيه الإبداعي         |                                                                                                                                                                                                                                                                                                    |
| Shoot                    | التصوير                  |                                                                                                                                                                                                                                                                                                    |
| Selection                | انتقاء اللقطات           |                                                                                                                                                                                                                                                                                                    |
| Retouching               | التنقيح                  | ⚠ Same Arabic as "Retouch" below. The two English strings come from different source documents and mean the same thing; ADR-0052 d.3 keeps the templates separate, so both steps ship — but the Arabic cannot distinguish them and should not try.                                                 |
| Final Artwork            | الفن النهائي             |                                                                                                                                                                                                                                                                                                    |
| Prepress                 | ما قبل الطباعة           |                                                                                                                                                                                                                                                                                                    |
| Proof                    | البروفة                  |                                                                                                                                                                                                                                                                                                    |
| Artwork                  | التنفيذ الفني            | ⚠ Split from "Final Artwork" (الفن النهائي) on purpose — in WF-05 both would otherwise be the same word, and they are different stages. Confirm the split.                                                                                                                                         |
| Research                 | البحث                    |                                                                                                                                                                                                                                                                                                    |
| Strategy                 | الاستراتيجية             |                                                                                                                                                                                                                                                                                                    |
| Creative Development     | التطوير الإبداعي         |                                                                                                                                                                                                                                                                                                    |
| Client Presentation      | العرض على العميل         |                                                                                                                                                                                                                                                                                                    |
| Brand System             | نظام العلامة التجارية    |                                                                                                                                                                                                                                                                                                    |
| Guidelines               | الدليل الإرشادي          |                                                                                                                                                                                                                                                                                                    |
| Asset Production         | إنتاج الأصول             |                                                                                                                                                                                                                                                                                                    |
| Key Visual               | التصميم الأساسي          |                                                                                                                                                                                                                                                                                                    |
| Asset Development        | تطوير الأصول             |                                                                                                                                                                                                                                                                                                    |
| Adaptations              | التكييفات                |                                                                                                                                                                                                                                                                                                    |
| Deployment               | النشر                    |                                                                                                                                                                                                                                                                                                    |
| Client Approval          | اعتماد العميل            |                                                                                                                                                                                                                                                                                                    |
| Production Specification | مواصفات الإنتاج          |                                                                                                                                                                                                                                                                                                    |
| Installation             | التركيب                  |                                                                                                                                                                                                                                                                                                    |
| Production Planning      | تخطيط الإنتاج            |                                                                                                                                                                                                                                                                                                    |
| Post-production          | ما بعد الإنتاج           |                                                                                                                                                                                                                                                                                                    |
| Final Master             | النسخة الرئيسية النهائية |                                                                                                                                                                                                                                                                                                    |
| Physical Production      | الإنتاج المادي           |                                                                                                                                                                                                                                                                                                    |
| QA                       | ضبط الجودة               |                                                                                                                                                                                                                                                                                                    |
| Physical Media           | الوسائط المادية          |                                                                                                                                                                                                                                                                                                    |
| Ingest                   | إدخال الوسائط            | ⚠ "Ingest" is a specific post-production act (copying camera media into the edit system), not generic importing. "إدخال الوسائط" is the closest; many facilities just say "الإنجست".                                                                                                               |
| Backup                   | النسخ الاحتياطي          |                                                                                                                                                                                                                                                                                                    |
| Assembly                 | التجميع الأولي           | ⚠ The assembly cut. "التجميع" alone is ambiguous with physical assembly, so "الأولي" was added to place it before Rough Cut.                                                                                                                                                                       |
| Rough Cut                | المونتاج الأولي          |                                                                                                                                                                                                                                                                                                    |
| Amendments               | تنفيذ الملاحظات          | ⚠ See "Revision". Rendered as "acting on the notes" to keep the two steps distinct; a reviewer may prefer plain "التعديلات" and a different word for Revision.                                                                                                                                     |
| Fine Cut                 | المونتاج الدقيق          | ⚠ "الفاين كت" is what editors say. "المونتاج الدقيق" keeps it MSA and orders correctly after المونتاج الأولي.                                                                                                                                                                                      |
| Final QC                 | فحص الجودة النهائي       |                                                                                                                                                                                                                                                                                                    |
| Archive                  | الأرشفة                  |                                                                                                                                                                                                                                                                                                    |
| Source Assets            | الأصول المصدرية          |                                                                                                                                                                                                                                                                                                    |
| Graphics                 | الجرافيك                 |                                                                                                                                                                                                                                                                                                    |
| Captions                 | الترجمة النصية           | ⚠ Ambiguous in the source: "Captions" on a short-form video may mean burned-in subtitles (الترجمة النصية) or on-screen text (النصوص على الشاشة). I read it as subtitles. Distinct from CNT-004 "Caption" = تعليق المنشور.                                                                          |
| Export                   | التصدير                  |                                                                                                                                                                                                                                                                                                    |
| Delivery / Scheduling    | التسليم / الجدولة        |                                                                                                                                                                                                                                                                                                    |
| Retouch                  | التنقيح                  | ⚠ Same Arabic as "Retouching" — see that entry.                                                                                                                                                                                                                                                    |
| Final Export             | التصدير النهائي          |                                                                                                                                                                                                                                                                                                    |
| Adaptation               | التكييف                  |                                                                                                                                                                                                                                                                                                    |
| Format Conversion        | تحويل الصيغ              |                                                                                                                                                                                                                                                                                                    |
| Copy / Graphics          | النصوص والجرافيك         |                                                                                                                                                                                                                                                                                                    |

## 6. Steps per template, in order

`sort_order` is 1-based, matching ADR-0052 d.2. Every Arabic value here is the §5 glossary entry — nothing is translated twice.

### WF-01 — Standard Digital · المسار الرقمي القياسي

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Copy/Content    | النصوص والمحتوى   |
| 3   | Design          | التصميم           |
| 4   | Internal Review | المراجعة الداخلية |
| 5   | Client Review   | مراجعة العميل     |
| 6   | Revision        | التعديل           |
| 7   | Approval        | الاعتماد          |
| 8   | Final           | النسخة النهائية   |

### WF-02 — Social Content · محتوى وسائل التواصل الاجتماعي

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Copy            | النصوص            |
| 3   | Creative        | العمل الإبداعي    |
| 4   | Internal Review | المراجعة الداخلية |
| 5   | Client Review   | مراجعة العميل     |
| 6   | Revision        | التعديل           |
| 7   | Final           | النسخة النهائية   |
| 8   | Scheduling      | الجدولة           |

### WF-03 — Video Production · إنتاج الفيديو

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Concept         | المفهوم الإبداعي  |
| 3   | Script          | السيناريو         |
| 4   | Storyboard      | الستوري بورد      |
| 5   | Pre-production  | ما قبل الإنتاج    |
| 6   | Production      | الإنتاج           |
| 7   | Edit            | المونتاج          |
| 8   | Sound           | معالجة الصوت      |
| 9   | Grade           | تصحيح الألوان     |
| 10  | Internal Review | المراجعة الداخلية |
| 11  | Client Review   | مراجعة العميل     |
| 12  | Revision        | التعديل           |
| 13  | Master          | النسخة الرئيسية   |
| 14  | Delivery        | التسليم           |

### WF-04 — Photography · التصوير الفوتوغرافي

| #   | Step (EN)          | العربية           |
| --- | ------------------ | ----------------- |
| 1   | Brief              | البريف            |
| 2   | Creative Direction | التوجيه الإبداعي  |
| 3   | Pre-production     | ما قبل الإنتاج    |
| 4   | Shoot              | التصوير           |
| 5   | Selection          | انتقاء اللقطات    |
| 6   | Retouching         | التنقيح           |
| 7   | Internal Review    | المراجعة الداخلية |
| 8   | Client Review      | مراجعة العميل     |
| 9   | Final              | النسخة النهائية   |

### WF-05 — Print · الطباعة

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Copy            | النصوص            |
| 3   | Design          | التصميم           |
| 4   | Internal Review | المراجعة الداخلية |
| 5   | Client Review   | مراجعة العميل     |
| 6   | Revision        | التعديل           |
| 7   | Final Artwork   | الفن النهائي      |
| 8   | Prepress        | ما قبل الطباعة    |
| 9   | Proof           | البروفة           |
| 10  | Production      | الإنتاج           |
| 11  | Delivery        | التسليم           |

### WF-06 — Packaging · التغليف

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Concept         | المفهوم الإبداعي  |
| 3   | Design          | التصميم           |
| 4   | Internal Review | المراجعة الداخلية |
| 5   | Client Review   | مراجعة العميل     |
| 6   | Revision        | التعديل           |
| 7   | Artwork         | التنفيذ الفني     |
| 8   | Prepress        | ما قبل الطباعة    |
| 9   | Proof           | البروفة           |
| 10  | Production      | الإنتاج           |
| 11  | Delivery        | التسليم           |

### WF-07 — Branding · بناء العلامة التجارية

| #   | Step (EN)            | العربية               |
| --- | -------------------- | --------------------- |
| 1   | Brief                | البريف                |
| 2   | Research             | البحث                 |
| 3   | Strategy             | الاستراتيجية          |
| 4   | Concept              | المفهوم الإبداعي      |
| 5   | Creative Development | التطوير الإبداعي      |
| 6   | Internal Review      | المراجعة الداخلية     |
| 7   | Client Presentation  | العرض على العميل      |
| 8   | Revision             | التعديل               |
| 9   | Approval             | الاعتماد              |
| 10  | Brand System         | نظام العلامة التجارية |
| 11  | Guidelines           | الدليل الإرشادي       |
| 12  | Asset Production     | إنتاج الأصول          |

### WF-08 — Campaign · الحملة

| #   | Step (EN)           | العربية           |
| --- | ------------------- | ----------------- |
| 1   | Brief               | البريف            |
| 2   | Strategy            | الاستراتيجية      |
| 3   | Concept             | المفهوم الإبداعي  |
| 4   | Key Visual          | التصميم الأساسي   |
| 5   | Internal Review     | المراجعة الداخلية |
| 6   | Client Presentation | العرض على العميل  |
| 7   | Approval            | الاعتماد          |
| 8   | Asset Development   | تطوير الأصول      |
| 9   | Adaptations         | التكييفات         |
| 10  | Final               | النسخة النهائية   |
| 11  | Deployment          | النشر             |

### WF-09 — OOH / Environmental · الإعلان الخارجي والتصميم البيئي

| #   | Step (EN)                | العربية           |
| --- | ------------------------ | ----------------- |
| 1   | Brief                    | البريف            |
| 2   | Concept                  | المفهوم الإبداعي  |
| 3   | Design                   | التصميم           |
| 4   | Internal Review          | المراجعة الداخلية |
| 5   | Client Approval          | اعتماد العميل     |
| 6   | Artwork                  | التنفيذ الفني     |
| 7   | Production Specification | مواصفات الإنتاج   |
| 8   | Production               | الإنتاج           |
| 9   | Proof                    | البروفة           |
| 10  | Installation             | التركيب           |
| 11  | Delivery                 | التسليم           |

### WF-10 — Long-form Physical Production · الإنتاج المادي المطوّل

| #   | Step (EN)            | العربية                  |
| --- | -------------------- | ------------------------ |
| 1   | Brief                | البريف                   |
| 2   | Concept              | المفهوم الإبداعي         |
| 3   | Creative Development | التطوير الإبداعي         |
| 4   | Production Planning  | تخطيط الإنتاج            |
| 5   | Production           | الإنتاج                  |
| 6   | Post-production      | ما بعد الإنتاج           |
| 7   | Internal Review      | المراجعة الداخلية        |
| 8   | Client Review        | مراجعة العميل            |
| 9   | Final Master         | النسخة الرئيسية النهائية |
| 10  | Physical Production  | الإنتاج المادي           |
| 11  | QA                   | ضبط الجودة               |
| 12  | Delivery             | التسليم                  |

### WF-11 — Long Form · المحتوى الطويل

| #   | Step (EN)       | العربية            |
| --- | --------------- | ------------------ |
| 1   | Brief           | البريف             |
| 2   | Pre-production  | ما قبل الإنتاج     |
| 3   | Shoot           | التصوير            |
| 4   | Physical Media  | الوسائط المادية    |
| 5   | Ingest          | إدخال الوسائط      |
| 6   | Backup          | النسخ الاحتياطي    |
| 7   | Assembly        | التجميع الأولي     |
| 8   | Rough Cut       | المونتاج الأولي    |
| 9   | Internal Review | المراجعة الداخلية  |
| 10  | Client Review   | مراجعة العميل      |
| 11  | Amendments      | تنفيذ الملاحظات    |
| 12  | Fine Cut        | المونتاج الدقيق    |
| 13  | Final QC        | فحص الجودة النهائي |
| 14  | Master          | النسخة الرئيسية    |
| 15  | Delivery        | التسليم            |
| 16  | Archive         | الأرشفة            |

### WF-12 — Short Form · المحتوى القصير

| #   | Step (EN)             | العربية            |
| --- | --------------------- | ------------------ |
| 1   | Brief                 | البريف             |
| 2   | Source Assets         | الأصول المصدرية    |
| 3   | Edit                  | المونتاج           |
| 4   | Graphics              | الجرافيك           |
| 5   | Captions              | الترجمة النصية     |
| 6   | Internal Review       | المراجعة الداخلية  |
| 7   | Client Review         | مراجعة العميل      |
| 8   | Amendments            | تنفيذ الملاحظات    |
| 9   | Final QC              | فحص الجودة النهائي |
| 10  | Export                | التصدير            |
| 11  | Delivery / Scheduling | التسليم / الجدولة  |

### WF-13 — Photography · التصوير الفوتوغرافي — مسار الإنتاج

| #   | Step (EN)       | العربية           |
| --- | --------------- | ----------------- |
| 1   | Brief           | البريف            |
| 2   | Shoot           | التصوير           |
| 3   | Physical Media  | الوسائط المادية   |
| 4   | Ingest          | إدخال الوسائط     |
| 5   | Selection       | انتقاء اللقطات    |
| 6   | Retouch         | التنقيح           |
| 7   | Internal Review | المراجعة الداخلية |
| 8   | Client Review   | مراجعة العميل     |
| 9   | Amendments      | تنفيذ الملاحظات   |
| 10  | Final Export    | التصدير النهائي   |
| 11  | Delivery        | التسليم           |
| 12  | Archive         | الأرشفة           |

### WF-14 — Adaptation / Versioning · التكييف وإصدار النسخ

| #   | Step (EN)         | العربية            |
| --- | ----------------- | ------------------ |
| 1   | Master            | النسخة الرئيسية    |
| 2   | Adaptation        | التكييف            |
| 3   | Format Conversion | تحويل الصيغ        |
| 4   | Copy / Graphics   | النصوص والجرافيك   |
| 5   | Internal Review   | المراجعة الداخلية  |
| 6   | Client Review     | مراجعة العميل      |
| 7   | Final QC          | فحص الجودة النهائي |
| 8   | Delivery          | التسليم            |
