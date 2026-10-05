# Brief templates — the four additional types (ADR-0048 d.1/d.2)

**Status: drafted 27 Aug 2026, awaiting Edward's review. Not yet seeded.**

the agency brief-template deck covers eight briefs, six of which map one-to-one onto the disciplines.
Edward asked for four more (`I14.4`, restated by ADR-0048 d.1). They are not in the deck and had no
content, which is why ADR-0048 d.2 seeds them **empty and unselectable** until authored. This file is
that authoring. It is the source the `brief_templates` seed migration transcribes, in the shape
ADR-0048 d.2 specifies: `key`, EN label, AR label, guidance, `multiline`, `required`.

**House rules carried from the deck**, unchanged:

- *"Fill only what moves the work forward. If a field doesn't apply, write N/A — never leave it
  blank."* Blank means outstanding and gets chased; `N/A` means considered and irrelevant.
- Every brief shares the header — brand/product, market(s), project name, brief date, deadline. That
  is campaign-level data the wizard already holds, so it is **not** repeated in any field list below.
- Every brief ends with an owners block. Per ADR-0048 d.7 those are **real rows** — `sub_task_resources`
  for required people, `sub_task_reviewers` for approvers — never free text, so they are not fields
  here either.

> **The Arabic needs a native speaker's review before this is seeded.** It follows the deck's register
> and terminology as closely as I could match, but I am not qualified to sign it off. Treat the
> English as ready and the Arabic as a first draft.

---

## 09 — Creative Strategy Brief · `creative_strategy`

بريف الاستراتيجية الإبداعية

**What it is for, and how it differs from 01.** The Creative Brief (01) briefs an *idea* for a 360
campaign. This one briefs the *strategic platform underneath it* — the thinking a campaign is built
on, often months earlier and often outliving several campaigns. If somebody is about to ask "what
does this brand stand for and who are we fighting", this is the brief; if they are about to ask "what
is the idea", that is 01.

| key | EN label | AR label | Guidance | Multi | Req |
|---|---|---|---|:--:|:--:|
| `background` | BACKGROUND | الخلفية | Where is the brand today, and what triggered the need for a strategy now? | ✓ | ✓ |
| `businessObjective` | BUSINESS OBJECTIVE | الهدف التجاري | What must the business achieve? Give numbers where you have them. | ✓ | ✓ |
| `category` | CATEGORY & COMPETITION | الفئة والمنافسة | Who else is in this space, and what does each of them already own? | ✓ | ✓ |
| `positioningNow` | POSITIONING TODAY | موقع العلامة اليوم | How is the brand actually seen now — honestly, not aspirationally. | ✓ | ✓ |
| `positioningTarget` | DESIRED POSITIONING | الموقع المنشود | Where must it stand instead? One sentence. | ✓ | ✓ |
| `audienceTension` | AUDIENCE & TENSION | الجمهور والتوتر | Who exactly, and what human or cultural tension can we build on? Mindset, not just demographics. | ✓ | ✓ |
| `brandRole` | BRAND ROLE | دور العلامة | What role does the brand play in that tension? What does it do that nobody else can? | ✓ | ✓ |
| `messageHierarchy` | MESSAGE HIERARCHY | تسلسل الرسائل | The one message that must land, then what supports it. Most important first. | ✓ | ✓ |
| `territories` | STRATEGIC TERRITORIES | المساحات الاستراتيجية | Two or three directions the creative work could explore. Territories, not executions. | ✓ | |
| `successMeasures` | HOW WE WILL KNOW IT WORKED | مقاييس النجاح | Business, brand and behaviour measures. Be specific. | ✓ | ✓ |
| `mandatories` | MANDATORIES & RESTRICTIONS | الإلزاميات والقيود | Non-negotiables, brand no-go zones, legal lines. | ✓ | |

---

## 10 — Communications Strategy Brief · `communications_strategy`

بريف استراتيجية التواصل

**What it is for, and how it differs from 04.** The Performance Brief (04) briefs paid media
execution — budgets, platforms, CPA targets. This one briefs the plan *above* that: what job each
channel does across the audience journey, and what we say at each stage. Its four stages are
deliberately the same four as the Creative Brief's omni-channel journey — awareness, consideration,
experience, loyalty — so a comms plan and a creative campaign describe the same journey in the same
words.

| key | EN label | AR label | Guidance | Multi | Req |
|---|---|---|---|:--:|:--:|
| `background` | BACKGROUND | الخلفية | What is happening in the business or the market that this plan answers? | ✓ | ✓ |
| `commsObjective` | COMMUNICATIONS OBJECTIVE | هدف التواصل | One sentence. What must communications achieve — not what the business must achieve. | ✓ | ✓ |
| `audienceJourney` | AUDIENCE & THEIR JOURNEY | الجمهور ورحلته | Who are we talking to, where do they start, and where do we meet them along the way? | ✓ | ✓ |
| `channelRoles` | CHANNEL ROLES | أدوار القنوات | Give every channel a job, not a line item. A channel with no job comes off the plan. | ✓ | ✓ |
| `msgAwareness` | MESSAGE — AWARENESS | الرسالة — الوعي | Get noticed. What breaks through, and what do we say first? | ✓ | |
| `msgConsideration` | MESSAGE — CONSIDERATION | الرسالة — الاهتمام | When they search and compare — what do we say? | ✓ | |
| `msgExperience` | MESSAGE — EXPERIENCE | الرسالة — التجربة | At the moment of truth — how do we win? | ✓ | |
| `msgLoyalty` | MESSAGE — LOYALTY | الرسالة — الولاء | After purchase — how do we keep them? | ✓ | |
| `phasing` | PHASING & KEY DATES | المراحل والتواريخ المهمة | Launches, offers, seasonal and cultural moments to plan around. | ✓ | ✓ |
| `budgetSplit` | BUDGET SPLIT | توزيع الميزانية | By channel or by phase, with the logic. Or N/A. | ✓ | |
| `integration` | INTEGRATION WITH OTHER WORK | التكامل مع الأعمال الأخرى | What else is running that this must fit with, or must not clash with? | ✓ | |
| `kpis` | KPIS | مؤشرات الأداء | How we define success for this plan. Set targets, not metrics. | ✓ | ✓ |
| `mandatories` | MANDATORIES & RESTRICTIONS | الإلزاميات والقيود | Handles, hashtags, CTAs, legal lines, competitors to avoid. | ✓ | |

---

## 11 — Brand Guidelines Brief · `brand_guidelines`

بريف الدليل الإرشادي للعلامة

**What it is for.** This briefs the *creation of a guidelines document* — a deliverable that outlives
every campaign. Unlike the others, its output is a reference other people work from, so it asks two
questions the campaign briefs never do: what format the document must take, and who owns it
afterwards. A guidelines document with no named custodian stops being true within a year.

| key | EN label | AR label | Guidance | Multi | Req |
|---|---|---|---|:--:|:--:|
| `background` | BACKGROUND | الخلفية | New brand, a refresh, or documenting what already exists? What triggered this? | ✓ | ✓ |
| `scope` | SCOPE | النطاق | Which assets are in scope — logo, colour, typography, imagery, voice, applications? Name what is out of scope too. | ✓ | ✓ |
| `existingAssets` | EXISTING ASSETS & THEIR STATE | الأصول الحالية وحالتها | What exists today, where it lives, and what condition it is in. Be honest about gaps. | ✓ | ✓ |
| `brandFoundation` | BRAND FOUNDATION | أساس العلامة | Purpose, values, personality — or where they are already written down. | ✓ | ✓ |
| `toneOfVoice` | TONE OF VOICE | نبرة الصوت | How do we sound? Three adjectives, plus what we never sound like. | ✓ | ✓ |
| `languages` | LANGUAGES & SCRIPTS | اللغات والخطوط | Arabic and English treatment, bilingual lockups, which script leads. | ✓ | ✓ |
| `applications` | APPLICATIONS REQUIRED | التطبيقات المطلوبة | Everywhere the guidelines must work: signage, social, packaging, OOH, digital, print. | ✓ | ✓ |
| `dosDonts` | DO'S & DON'TS TO CAPTURE | المسموح والممنوع | Misuses already seen in the wild are the most valuable entries here. | ✓ | |
| `references` | REFERENCES & INSPIRATION | المراجع والإلهام | Guidelines from other brands worth learning from, and why. | ✓ | |
| `deliverableFormat` | DELIVERABLE FORMAT | صيغة التسليم | PDF, editable source, web? Roughly how many pages, and who has to be able to open it? | ✓ | ✓ |
| `custodian` | APPROVAL & CUSTODIAN | الاعتماد وأمين العلامة | Who signs it off, and who owns keeping it true afterwards. | ✓ | ✓ |

---

## 12 — Custom Brief · `custom`

بريف مخصص

**What it is for, and why it is short.** The escape hatch, for work that fits none of the other
eleven. It is deliberately the shortest template in the system: every field earns its place, and the
temptation to grow it into a catch-all should be resisted. **If a kind of work keeps arriving as a
custom brief, that is the signal to give it a template of its own — not to add fields here.**

| key | EN label | AR label | Guidance | Multi | Req |
|---|---|---|---|:--:|:--:|
| `background` | BACKGROUND | الخلفية | Where are we today, and what triggered this brief? | ✓ | ✓ |
| `task` | THE TASK | المهمة | One sentence. What must this work achieve? | ✓ | ✓ |
| `audience` | AUDIENCE | الجمهور | Who is this for? Mindset, not just demographics. | ✓ | |
| `deliverables` | DELIVERABLES | المخرجات | Every item we must hand over, with versions and sizes where they matter. | ✓ | ✓ |
| `mandatories` | MANDATORIES & RESTRICTIONS | الإلزاميات والقيود | Non-negotiables, restrictions, no-go zones. | ✓ | |
| `successMeasures` | HOW WE WILL KNOW IT WORKED | مقاييس النجاح | How success is judged. Be specific. | ✓ | |

---

## Notes for whoever writes the seed migration

- **Twelve types total** once these four join the deck's six campaign briefs plus the two relocated
  ones (ADR-0048 d.1). The numbering above (09–12) continues the deck's own so the two documents read
  as one system.
- **Every field here is `multiline`.** None of the four collects a number, a date or a single token —
  that is a property of strategy briefs, not an oversight. The deck's Performance Brief is where the
  short numeric fields live.
- **`required` is enforced at generation, not at save.** A required field the source does not address
  comes back `N/A` (ADR-0048 d.6), which satisfies it. Required means *the model must address it*,
  not *the user must type in it*.
- **Guidance text is the model's prompt as well as the human's hint** (ADR-0048 d.2). It is written in
  the second person and phrased as a question on purpose; changing it changes generated output, so
  treat edits to it as a content change with a visible effect, not as copy-editing.
