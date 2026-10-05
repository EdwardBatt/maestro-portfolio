# Arabic for the native reader — 23 September 2026

`I54.5` / `I18.8`. Every string below is **in the product already**, in both languages.
Nothing here is missing; what is missing is a native speaker having read it. This sheet
exists so that can happen in one pass rather than by hunting through the code.

Mark anything that is wrong, clumsy, or right-but-not-how-we-say-it. Send it back and the
corrections go in as a migration (the template rows) and a locale edit (the interface).

---

## 1 · The twelve brief cards — first screen of the single job

Stored in the database (`brief_templates`), seeded by migration `20260922130000`. The NAME is
the card title; the DESCRIPTION is the line under it.

**The six marked ⭑ are the ones written for this build** — they are not from the Figma and
have never been checked by anyone. The other six follow the agency’s own deck.

| | Key | English name | Arabic name | English description | Arabic description |
|---|---|---|---|---|---|
| ⭑ | `360` | Creative Brief | بريف إبداعي — حملات ٣٦٠ | The campaign brief — the season in one line, the product rules, the dos and don’ts. | بريف الحملة — الموسم في سطر واحد، وقواعد المنتج، والمسموح والممنوع. |
|  | `social_calendar` | Social Media Brief | بريف السوشيال ميديا | Posts, carousels, reels — with the caption and the channel. | منشورات وكاروسيل وريلز — مع النص والقناة. |
|  | `activation` | Activation Brief | بريف التفعيل | Events, on-ground and live moments. Rundown and talent. | فعاليات ولحظات ميدانية ومباشرة. البرنامج والمواهب. |
| ⭑ | `paid_media` | Performance Brief | بريف الإعلانات الممولة | Paid campaigns — the objective, the budget, the platforms and the numbers that count. | الحملات الممولة — الهدف والميزانية والمنصات والأرقام التي تهم. |
|  | `production` | Production Brief | بريف الإنتاج | Anything shot, edited or animated. Script, duration, location. | كل ما يُصوَّر أو يُمنتَج أو يُحرَّك. النص والمدة والموقع. |
|  | `influencer` | Influencers Brief | بريف المؤثرين | Per influencer, per week. Planned versus posted. | لكل مؤثر، لكل أسبوع. المخطط مقابل المنشور. |
|  | `single_execution` | Execution Brief | بريف تنفيذي | One asset, already agreed. Just say what you need. | أصل واحد متفق عليه. قل ما تحتاجه فقط. |
| ⭑ | `creative_strategy` | Creative Strategy Brief | بريف الاستراتيجية الإبداعية | Where the brand stands and the idea that moves it. | أين تقف العلامة والفكرة التي تحرّكها. |
| ⭑ | `communications_strategy` | Communications Strategy Brief | بريف استراتيجية التواصل | Who we talk to, what we say, and through which channels. | مع من نتحدث، وماذا نقول، وعبر أي قنوات. |
| ⭑ | `brand_guidelines` | Brand Guidelines Brief | بريف دليل الهوية | A new brand, a refresh, or the rules written down. | علامة جديدة، أو تحديث، أو القواعد مكتوبة. |
| ⭑ | `custom` | Custom Brief | بريف مخصص | Anything the other briefs do not fit. Start from a blank page. | كل ما لا يناسب البريفات الأخرى. ابدأ من صفحة فارغة. |
|  | `digital_build` | Digital Build Brief | بريف البناء الرقمي | Sites, landing pages and in-app surfaces. Ships EN, AR, KU. | مواقع وصفحات هبوط وواجهات داخل التطبيق. بالعربية والإنجليزية والكردية. |

> `digital_build` — *Digital Build Brief* / *بريف البناء الرقمي* — is called out separately in
> `I54.5` because its Arabic name was the one added last, by ADR-0071.

---

## 2 · Screen 1 of the single job — the interface itself

From `src/locales/`, key `intake.briefType.*`. `{{...}}` is a value the system fills in and
must survive unchanged; everything around it is yours.

| Key | English | Arabic |
|---|---|---|
| `title` | What are we making? | ماذا سنصنع؟ |
| `intro` | Say who it is for, then pick the kind of brief. The questions, the fields and the team all change to suit it. | حدّد لمن هو العمل، ثم اختر نوع البريف. الأسئلة والحقول والفريق تتغير كلها بحسبه. |
| `search` | Search briefs — try “post”, “shoot”, “influencer” | ابحث في البريفات — جرّب «منشور»، «تصوير»، «مؤثر» |
| `forWhom` | For whom | لمن |
| `forWhomSub` | The brief inherits their profile | يرث البريف ملفهم |
| `inheritsBrand` | The {{brand}} library and its folders come with this choice. | مكتبة {{brand}} ومجلداتها تأتي مع هذا الاختيار. |
| `inheritsClient` | {{client}}'s library and folders come with this choice. Pick a brand to narrow it. | مكتبة {{client}} ومجلداته تأتي مع هذا الاختيار. اختر علامة لتضييقها. |
| `inheritsNone` | Pick a client and the brief takes on their library. | اختر عميلاً ليأخذ البريف مكتبته. |
| `evidence` | How it came in | كيف وصل الطلب |
| `evidenceSub` | Who asked, how, and the proof — the clock starts from the confirmed arrival. | من طلب، وكيف، والإثبات — يبدأ العداد من الوصول المؤكد. |
| `kindOfBrief` | Kind of brief | نوع البريف |
| `fields` | {{n}} fields | {{n}} حقول |
| `noDepartment` | No department yet | لا قسم بعد |
| `usedFor` | {{campaign}} · {{n}} briefs | {{campaign}} · {{n}} بريفات |
| `notUsed` | Not used for {{client}} yet | لم يُستخدم لـ {{client}} بعد |
| `noTemplates` | No brief template has any fields yet. An administrator adds them under Admin → Brief templates. | لا يوجد قالب بريف فيه حقول بعد. يضيفها المسؤول من الإدارة ← قوالب البريف. |
| `noMatch` | Nothing matches “{{query}}”. Clear the search to see every brief. | لا شيء يطابق «{{query}}». امسح البحث لترى كل البريفات. |
| `start` | Pick a brief to start | اختر بريفاً للبدء |
| `startNamed` | Start the {{name}} | ابدأ {{name}} |
| `campaignInstead` | More than one deliverable? Start a campaign instead | أكثر من مخرج واحد؟ ابدأ حملة بدلاً من ذلك |
| `inherits` | Inherits | يرث |
| `inheritsLine_one` | {{count}} dos-and-don’ts rule and the {{library}} library come with this choice. | قاعدة واحدة ومكتبة {{library}} تأتي مع هذا الاختيار. |
| `inheritsLine_other` | {{count}} dos-and-don’ts rules and the {{library}} library come with this choice. | {{count}} قواعد ومكتبة {{library}} تأتي مع هذا الاختيار. |

---

## 3 · Priority — renamed 23 September

`intake.who.priorities.*`. **Low became Normal** (Edward, 23 Sep). The Arabic follows it:
`منخفضة` → `عادية`. This is the one string on this sheet that changed today, so it is the
one most worth a second opinion.

| Key | English | Arabic |
|---|---|---|
| `high` | High | عالية |
| `medium` | Medium | متوسطة |
| `low` | Normal | عادية |

---

## 4 · Admin → Brief templates — added 23 September

`admin.briefTemplates.*`. New with `I54.3`, so also unread.

| Key | English | Arabic |
|---|---|---|
| `nameEn` | Name (EN) | الاسم (إنجليزي) |
| `nameAr` | Name (AR) | الاسم (عربي) |
| `descriptionEn` | Description (EN) | الوصف (إنجليزي) |
| `descriptionAr` | Description (AR) | الوصف (عربي) |
| `descriptionHint` | The line the card shows when somebody is choosing a brief | السطر الذي تعرضه البطاقة عند اختيار نوع البريف |
| `namingNote` | Renaming is safe: briefs already written from this template keep their link to it. | إعادة التسمية آمنة: البريفات المكتوبة من هذا القالب تحتفظ بارتباطها به. |
| `newNameAr` | Arabic name | الاسم بالعربية |

