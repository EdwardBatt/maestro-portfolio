# ADR-0117: A campaign or single job has languages, and every deliverable gets one translation task

- **Status:** accepted
- **Date:** 2026-09-27
- **Open Decision:** none
- **Task(s):** I60.3, I60.4, I60.5, I60.6, I60.7 (extends I56.7; ADR-0052 d.5 task-list generation)

## Context

A campaign is made in several languages — the frames' own LUMA example is Arabic, English and Kurdish — but
nothing records which. Each piece carries the ONE language it ships in (`I56.7`, a `language` value from
`deliverable_attribute_values`, where English, Arabic and Kurdish are seeded), and the rule dialog on step 2
reads the same list. Admins edit the other attribute lists (channel, format, …) on the *Deliverable types*
page, but language is not among them. The task list a deliverable is given (ADR-0052 d.5,
`app.materialise_deliverable_workflow`) has no translation step.

Edward, 27 Sep:

> *"on step 2 of the wizard, we need to add an additional section for languages, allowing a user to select
> multiple languages … a dropdown, showing available languages and an add language button … the defaults
> are English, Arabic and Kurdish. There should also be an editable table for admins to add or edit the
> choices and if users add a language not already available it should be added. the dropdown should be a
> smart filter. Once languages are selected, when the task lists are created for deliverables a translation
> task needs to be added, which includes all languages selected (single task for all languages)."*

Asked, he answered:

- **When** a deliverable gets the task — only with two or more languages (A, recommended), or whenever any
  language is chosen (B): *"As tasks can be removed generate a translation task for all"* — **B**.
- **Where** in the list — straight after *Write Copy* (A, recommended: artwork needs the translated words),
  or at the end (B): **A**.
- **Each piece's own language** (`I56.7`) — keep it, offering only the campaign's languages (A, recommended),
  or remove it (B): **A**.
- **Single jobs** — on reading the first draft: *"Single jobs need translation as well."* Asked where a single
  job chooses its languages — step 3 beside what is being made (A, recommended), or a section of the brief on
  step 2 (B): **A**.

Adding a language from the wizard writes to a catalogue only `organization:manage` may write (RLS on
`deliverable_attribute_values`). A campaign author holds `projects:manage`, not that — so the add goes
through one narrow function.

## Decision

1. **A campaign carries its languages.** `campaigns.languages text[] not null default '{}'` — codes from the
   tenant's `language` list, in the order chosen. Step 2 of the wizard has a **Languages** section: a
   smart-filter drop-down of the tenant's languages (type to narrow), picked into a list, each removable, and
   **Add language** for one that is not there. Written with the rest of the campaign by
   `app.write_campaign_content`.
   - **A single job carries them too** — it is a campaign row (ADR-0083 d.3), so the same column. Step 3's
     *What is being made* has the same Languages control, beside what is being made, how many, channel and
     format; they are saved with the job and restored when it is resumed.
2. **The list is the tenant's `language` values**, English / Arabic / Kurdish by default (already seeded for
   every tenant, `app.seed_tenant_languages`). **Admins edit it** on the *Deliverable types* page — `language` joins that page's
   attribute lists, same table, same rules.
3. **A language typed that is not in the list is added to it.** `public.add_language(p_label text)` —
   `security definer` (authorised here), `search_path` pinned; refuses without `projects:manage` in the
   caller's tenant; trims the label; if a language with that label already exists (case-insensitive) returns
   its code; otherwise inserts one with a code made from the label (lower-case Latin letters, or `lang-N`
   when the label has none) and returns the new code. Audited like every write to the table.
4. **Every deliverable of a campaign or single job with at least one language gets one translation task** when its task
   list is created — **"Translation — ‹deliverable› (English, Arabic, Kurdish)"**, one task naming every
   language, `todo`, unassigned, on the deliverable's department, digital review, like the other generated
   tasks (ADR-0052 d.4). The owner removes it where it is not wanted (ADR-0052 d.12).
5. **It sits straight after *Write Copy*** — the step whose English title begins "Write Copy" in the
   deliverable's workflow; with no such step it is **last**.
6. **Created once.** The task-list builder adds it when it runs (on release, and for a piece added later) if
   the deliverable has none yet; changing the campaign's languages afterwards does not rewrite existing task
   lists.
7. **A piece's own language** (`I56.7`) stays, and offers only the campaign's languages; with none chosen it
   offers the whole list, as today.

## Consequences

*Easier:* the languages a campaign or job is made in are recorded once and every deliverable's list says who
translates, before anyone is assigned; admins keep the list in the place they keep the others.

*Harder:* a campaign with one language still gets the task on every piece — removed by hand where not
wanted (Edward's choice). The *Write Copy* match is by the step's English title; a template that renames
that step moves the translation task to the end until the rule is told otherwise.

*Locked in:* one translation task per deliverable, not one per language; languages are campaign-level codes
from the tenant list.

*Cost:* one migration (column, defaults, `add_language`, the builder and the content writer re-emitted);
step 2's section on the campaign and step 3's on the single job; the admin page's list gains `language`; the piece dialog's language list narrowed; pgTAP
for the function's authority and the task's name, place and once-only; unit and browser checks.

## Addendum — 4 Oct (Edward, Q18–Q20)

Asked one at a time on 4 Oct, while the Schedule rework was being tested (`I74`):

- **Q19 — a campaign or single job must have at least one language.** No default: the person picks one or more.
  Until now the wizard let a campaign through with none, and its deliverables then had no language and no
  translation task. *Amends d.1.*
- **Q18 — a deliverable starts with its campaign's languages, and a language can be added to that deliverable
  alone** — its own; the campaign's languages do not change. Chosen with the existing picker (the smart filter,
  chips with a remove icon, **Add language** → `add_language`), as on step 2 and the single job. *Amends d.7*: a
  deliverable no longer carries ONE language offered from the campaign's; it carries a list, any of the tenant's,
  at least one.
- **Q20 (A) — the deliverable's translation task follows its languages.** When they change, the task is renamed —
  "Translation — ‹deliverable› (English, Arabic, Kurdish)", the English names in the order chosen — and its
  assignee, if any, is told. A deliverable with a task list and no translation task gets one, placed as d.5 says.
  *Amends d.4* (the task names the deliverable's languages, not the campaign's) *and d.6* (no longer "created
  once": it follows the deliverable's languages; changing the campaign's still rewrites nothing).

How it is held (migrations `20261004130000`, `20261004140000`):

1. `deliverables.languages text[]` is the one source of truth; `deliverables.language` (I56.7) was moved into it
   (a deliverable with one → that one; with none → its campaign's) and dropped. A deliverable created with none
   takes its campaign's. The wizard's deliverable dialog still turns several languages into several deliverables
   (I56.7) — each starts with the language it was made for.
2. The edit guard covers `languages` with ADR-0141 d.1's gate unchanged (on a live campaign: the account manager,
   the account director, Traffic, the Power Admin). The last language is never taken away (hint
   `languages_required`); a code not on the tenant's list is refused (`language_unknown`).
   `update_piece_details(p_deliverable, p_channel, p_languages text[], p_notes)` takes the list (null leaves it).
3. The task-list builder names the deliverable's languages; a change of them renames the live translation task and
   tells its assignee (`translation_languages_changed`, in the bell and by email in English and Arabic). A
   translation task the owner cancelled stays cancelled.
4. A campaign or single job cannot leave draft without a language — refused on the row when the submit moves it
   out of draft, and when the one-shot create writes its content (hint `campaign_languages_required`). Drafts may be
   saved with none. Campaigns already past draft with none are left as they are and are listed by
   `scripts/db/campaigns-without-language.sql` for their account managers.

Tracker: `I74.34` (a campaign requires a language), `I74.35` (a deliverable's languages, the existing picker),
`I74.36` (the translation task follows).
