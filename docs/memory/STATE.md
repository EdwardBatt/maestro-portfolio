---
type: state
status: current
origin: ai-derived
verified: 2026-10-04
sources: [docs/TASKS.md, git log, src/, supabase/, Edward's pilot reports 24-26 Aug 2026, the first acceptance run 29-31 Aug 2026]
---

# Current state

What is actually built, as of **2026-09-25** (re-opening, the brief after promotion and the I57 fixes checked against the code and the local database that day; the campaign wizard and section C on 2026-09-24; everything older last checked 2026-09-20). [TASKS.md](../TASKS.md) is the authoritative tracker
and carries the detail; this is the fast answer to "does this exist yet?".

**Do not assume something works because code for it exists.** Several areas below are shape only.

## Working — exercised by real users in the pilot

Sign-in and password reset (OTP codes, not links) · RBAC with per-user overrides · the day-cell
schedule grid with drag-to-reschedule, per-office working weeks and capacity warnings · booking
create/edit/cancel · ad-hoc task assignment from the schedule · My Work queue with Start/Submit and a
timer · internal review — version uploads to B2, pinned and timecoded feedback, request-changes
round-trip · task approval and ad-hoc deliverable sign-off · the Deliverables and Pipeline screens ·
in-app notification inbox and the email slow lane · the
asset Library · client and campaign registration with the brief wizard · admin screens for users,
resources, roles and organization · the dev "view as role" preview.

**Added 30–31 Aug, and this is the big one:** the campaign path runs **end to end** for the first
time — a pasted brief becomes deliverables, becomes a planned and approved campaign, becomes a task
assigned to a named person on the schedule, with that person notified. Every link in that chain was
broken somewhere until this week, and most of the breaks were silent. Driven through the real
application by Edward as far as **Part 3** of the acceptance run.

**Added 6 Sep (I40):** a campaign is now READ the same way wherever you open it. Step 5 of the wizard
and `/campaigns/:id` share one layout — the campaign brief, a tab per department, all deliverables —
and the department's brief is generated on its own tab, by the department, never by a sweep above
every department. Ten migrations of authorization went with it (ADR-0072/0073/0074): `projects:manage`
is scoped everywhere it is checked, the approver list is computed in Postgres from grants and scope,
and the Account Director reaches every account by a reach it is SET to rather than by its name
written into a function. All ten are applied and `database.ts` was regenerated.

## Partially built

| Area | Built | Missing |
|---|---|---|
| **Multiple reviewers per task** (I14.1, ADR-0043) | **Live and applied.** `sub_task_reviewers` with `is_mandatory` + per-reviewer `approved_at`; `sub_tasks.reviewer_id` dropped. Completion is held by Postgres (`app.tg_sub_task_completion_guard`) and re-asked when appointments change. A deactivated person can no longer be APPOINTED (ADR-0061 d.10), and one deactivated AFTER appointment is marked on the waiting-on line rather than deleted | still not exercised by real users end to end — Part 4 of the acceptance run is where that happens |
| **Created by / modified by** (I51.1, 16 Sep) | **Every tenant table carries `created_by` / `updated_by`, filled by `app.set_actor_columns`, enforced by pgTAP 123; shown on the campaigns drafts table and the campaign / deliverable headers (`Provenance`); the audit page names campaigns, briefs, deliverables, tasks, jobs and says where they sit (`I51.2`).** | Provenance on every other record's header (resources, clients, templates…) — nothing stops it, nobody asked. The columns carry NO foreign key on purpose (traps.md). |
| **A person's "Waiting on you"** (I51.9) | Notifications are doors to the thing itself (`I51.7`: an extension request opens the task inside its deliverable); the AM can open My Work (`I51.8`). | The panel listing what only you can move — campaigns, briefs, task lists, extensions, booking requests. **Parked with the dashboard / My Work redesign (`I48.16`), Edward 16 Sep.** |
| **Sub-task resources** (I13.1, ADR-0042) | table, RLS, span narrowing **live**. Scheduler placement, hours-not-days and clash alerts merged; the editor is on `/deliverables` and the `/schedule` modal | nothing — **I13.1 is complete**. Not yet exercised by real users |
| **Contextual chat** (I4, ADR-0015/0027 → **0062/0063**) | **Rebuilt 31 Aug (I31 + I32) — applied and deployed.** The gate admitted four kinds of person and had **no notion of a reviewer**: measured live, a large share of the tenant's users were shut out, including the C-suite and every Team Member. Now `app.can_read_conversation` in Postgres: participants (assignee ∪ `sub_task_reviewers` ∪ assigner ∪ owner ∪ AM) ∪ leads whose `in_write_scope` covers a participant ∪ `chat_oversight:view` ∪ people invited by name (`conversation_members.added_by`, server-stamped, emails them). `/chat` is three columns — campaigns → deliverables, ad-hoc its own group, members visible on every thread. `isAdhoc` now comes off the deliverable, not the open tab. `chat` gained Zod. **The pgTAP suite caught a cross-tenant hole before it shipped**: `chat_oversight` short-circuited ahead of any tenant check, so a Traffic Manager in tenant B could read tenant A's threads (`077` test 20) | All seven migrations are applied and `chat`/`notify-email` are deployed (verified against the live project, 31 Aug). Naming deviation on record: the permission is `chat_oversight:view`, not ADR-0062 d.4's `chat:oversight`, because `permission_catalog.action` admits only eight verbs (ADR-0055 precedent). Rail entitlement is O(n) in the tenant's deliverables — fine at current volume, paginate later |
| **Campaign delivery status** (I16.8, ADR-0018 d.4) | **DONE 31 Aug.** Progress, blocked, overdue and due dates are on `/campaigns/:id` — campaign-wide and per department. They existed since August on a page **nobody could open**: `/campaigns/:campaignId` was declared **twice** in `router.tsx` and the first match won, silently, from `800666c` (27 Aug). Rollup math now in `src/lib/campaigns/status.ts`; `src/app/router.test.ts` fails the build on any duplicate path | the **general** Tier-2 oversight feed (`V1.5`) is still not built — `exceptions:view` is seeded to five roles (Power Admin, AM, Dept Lead, Team Leader, Deputy TL) and **read by nothing in `src/`**. ADR-0018 d.8 gated it on the ADR-0010 engine; **that blocker has lapsed** — states, due dates, blocked and assignment all exist now |
| **Ad-hoc on `/deliverables`** (I13.2) | live and finished ad-hoc work both listed, shown apart; live items carry the requirements editor | — |
| **Library filing** (I11.4) | `deliver_deliverable_version` / `promote_delivered_version_to_final` exist | **nothing calls either** — approval files nothing into the Library, for campaign work too |
| **Admin configuration** (M6.4) | users, resources, roles, organization, SLA profiles | work types have no CRUD; they are seeded and read-only |
| **Schedule polish** (M5.6) | department / team / kind / office filters, plus a **name search** and a **sticky date row** (31 Aug) | RTL visual pass on the grid, full-pool performance check |
| **Asset filing** (L1.5) | folder tree, auto-provisioning, B2 storage, Library UI; the upload path is now shared code in `src/lib/assets/upload-asset.ts` | the general reference-file picker on wizard step 1 (I14.6); `is_system` folder protect-trigger (UI-only today) |
| **Department brief APPROVAL** (I37/I40, ADR-0070 + 0072/0073) | **Working, and reachable by the intended people only since 6 Sep.** The gate itself has worked since 3 Sep; who could pass it had not been tested per-actor. Two of the four intended approvers were refused by a null argument (see traps.md) — the department's **Team Leader** and the campaign's **Account Manager**, both fixed in `20260905210000` and each now asserted through the real RPC. Confirmed able: Power Admin, Traffic Manager, Account Director (ADR-0073), the campaign's AM, the department lead, a team lead of that department. Step 5's approver LIST is now computed in Postgres (`department_brief_approvers`) — the department's lead plus the person the campaign assigned, from grants and scope, never role names. **Narrowed again 6 Sep** after Edward read it live: the list also admitted anyone holding a per-user SCOPE grant over the department, which in the live tenant included several Account Managers, the Account Director, a Team Leader and a Team Member — none of them given work on the campaign and none of them leading it. A scope grant says what somebody may WRITE, not whose brief they answer for (`20260906100000`) | the list deliberately omits the agency-wide failsafe (ADR-0070 d.6) and now the scope-grant holders too — a display choice, not a limit: both can still approve, and the pgTAP suite asserts both halves so they cannot drift |
| **Brief wizard drafts** (ADR-0067, I40.11) | **Resumable for real since 6 Sep.** `update_campaign_draft` saved brand, name and account manager only; everything typed on steps 2–4 lived in React state until submit, so a resumed draft opened with step 1 filled and four blank steps. It now carries the brief and go-live date, `coalesce`d so null means LEAVE ALONE and returning to step 1 cannot erase later steps. Deliverables ride inside the same `campaigns.brief` jsonb the submit path already wrote | the deliverable ROWS are still created once, at submit — a draft stores what was typed, not work |
| **Department briefs** (I16.4, ADR-0048) | **Working, first used 30 Aug.** `generate-brief` shipped 27 Aug and *nothing ever called it* — `campaign_briefs` was permanently empty and every campaign section read "not written yet". Now: a department may use several briefs (`department_brief_templates`, many-to-many, set on Admin → Brief templates), the campaign page writes one per department from the brief that department is using, and a generated brief is **editable in place** (`projects:manage`, mirroring the RLS). **A department now has a DEFAULT brief** (`department_brief_templates.is_default`, one per department held by a partial unique index, set on Admin → Brief templates, `20260906120000` applied). It restores the automatic selection `departments.brief_template_id` gave before 30 Aug WITHOUT restoring the limit that stopped Creative holding a second brief. Backfilled where a department has one template: **Performance and Influencers have theirs; Creative (7 templates) and Content (3) have none and still ask** — two ticks Edward has not made yet. Never silent: the tab states which brief it will use, and the dropdown overrides it | deriving the brief from the deliverables was measured and refused — TEST CAMPAIGN 23's four Creative deliverables tie at one match each across three briefs and the right answer scores zero, because `brief_deliverable_types` files its 17 campaign rows under the reserved key `campaign_360` while the Creative Brief template's type is `360`. **That key mismatch is a live data fault** (and `digital_build`'s 7 rows have no template at all), which also means the wizard's deliverable picker cannot sort for the main creative brief. The MASTER brief and the deliverable list are still read-only, though ADR-0048 d.9 says the whole package should be correctable |
| **Creative concepts per department** (I34 / I48.15, ADR-0065 + 13 Sep addendum) | **Rebuilt 13 Sep as ONE working concept per brief** (not yet seen in a browser): `propose-concepts` proposes strategic thinking / creative direction / pillars (no content types, d.9) on a first press, and on a later press REGENERATES only the slots that deletions opened, with the kept items as fixed context (d.11); `campaign_concepts` is unique per brief, items carry ids, `campaign_concept_mark_item(keep|delete)`, an UPDATE policy behind `projects:manage`, a regeneration stamp (`20260913180000`, pgTAP 113, 078 amended). `ConceptsPanel` shows Keep/Delete per item and "Regenerate removed (n)". Existing sets were collapsed to the newest per brief by the migration | `I34.5` (measure real cost) can only be done from live use. `brief_deliverable_types` is no longer relevant to this call — the content-type suggestion is gone
| **Brief ingestion** (I14.3, ADR-0044 + **ADR-0049**) | **Live and functioning** — corrected 31 Aug. `ingest-brief` is DEPLOYED (v1) and calls **OpenAI's Responses API**, default `gpt-5.6-luna`, secret `OPENAI_API_KEY` — **set and working**. ADR-0049 switched the provider off Anthropic for an account/billing reason, not a technical one; one file changed and the strict-mode output schema needed none. Also live: `src/lib/brief/` (heading fallback, merge rule, client-side `.docx`/`.txt`/`.md` extraction), the Strategy-step panel with machine-filled markers, source-document filing into the campaign's References folder. The licence gate is CLEARED (**ADR-0047**): `Zlib` allowlisted, MIT elected for `jszip`, `duck` pinned at `0.1.12` — `npm run check:licenses` passes at 192 packages with `mammoth` installed. | **ADR-0044 d.6 is re-opened by ADR-0049 d.6** and is the only thing outstanding: the residency/no-training acceptance was given against *Anthropic's* terms and does not transfer. On the OpenAI account that owns the key, confirm the no-training default is not opted out and decide whether zero retention is needed. Neither is enforced by code. Also still open: `I14.5` step-1 validation, `I14.6` the reference-file picker |

## Not built — code referencing these is shape only

Joint projects across tenants (M8) · the client portal (M10) · time tracking and utilization (V1.1) ·
rates and finance export (V1.2, V1.3) · Collabora deck editing (V1.9) · LiveKit huddles (V1.10) · the
Phase-2 accountability surfaces (P2.*) · derived KPIs · **rooms and equipment as "free → booked,
taken → a request its owner answers" (ADR-0094, accepted 16 Sep; `I50.1`–`I50.8`, ON HOLD by
Edward — nothing written)** · freelancers / external resources / third-party access (no ADR, no
task; Edward asked 16 Sep — the nearest designed work is M8 and M10).

## Confirmed problems — verified 2026-08-26

- ~~`notifications.type.cancelled` had no locale key~~ — **confirmed and fixed 26 Aug.** The type has been valid since 24 Aug, so a cancelled-task notification rendered as its raw key.

- ~~**7 of 16 notification types sent no email at all.**~~ **Fixed 6 Sep (`I30.2`/`I30.3`).**
  `notifications_type_check` allowed sixteen; `notify-email`'s `COPY` map carried eight, and the
  other seven — `cancelled` (raised from 28 places), `resource_clash`, `resource_required`,
  `campaign_approved`, `deliverable_reassigned`, `rescheduled`, `task_reinstated` — returned
  `200 {skipped:'no_copy'}`. The bell rang; the email never came. **Worth remembering for the
  shape, not the fix:** `COPY` is typed against a hand-written `NotifType` union in the same file,
  so the compiler confirmed the map was complete against the copy of the list that was wrong.
  `src/test/notification-copy.test.ts` now reads the constraint out of the migration.
- ~~**17 tenant-scoped tables were not audited at all.**~~ **Fixed 6 Sep.** The universal audit
  trigger was attached to a hand-written list of 22 tables on 2 Aug and never extended, so every
  brief, template, concept and asset table built since was invisible to the audit log — and the
  screen looked complete while doing it. Now attached to all of them, with the rule in `AGENTS.md`
  §6 and pgTAP `092` failing the build on any tenant-scoped table that lacks it. **The shape is
  worth remembering:** a hand-written list of a moving thing is only right on the day it is written.
- **4 Edge Functions parse input without Zod** — `asset-url`, `list-user-status`,
  `notify-email`, `review-media`. `chat` gained it on 31 Aug when it was rewritten (I31). `AGENTS.md` requires it at every function boundary.
- **34 cross-feature import edges** against the feature-isolation rule — it was 21 on 26 Aug, so
  this is getting worse. Worst: `schedule`→`deliverables` (6), `campaigns`→`admin` (5),
  `campaigns`→`deliverables` (4), `bookings`→`deliverables` (3). Recounted 6 Sep.
- **A test file whose import graph reaches `lib/supabase` unmocked fails as "0 test", not as a named
  assertion.** `lib/env` Zod-parses `import.meta.env` at import time and throws where no `VITE_` vars
  exist — which is CI and never a developer's machine. It cost a red build on 6 Sep
  (`BriefWizard.test.tsx`, one unmocked `fetchAssetDownloadUrl` import). A TYPE-only import is
  erased and safe; a value import is not.
- **54 files still on `supabaseUntyped`** rather than the typed client — 28 on 26 Aug, 45 on 31 Aug,
  so this is getting worse, not better. Most of the growth is new call sites written while types
  lagged a migration; they were never moved back once `gen types` caught up.
- **The production bundle is one >500 kB chunk** (no code splitting).
- ~~No e2e coverage of the dev role preview~~ — covered 15 Sep (`admin-catalogues-feedback-shell.spec.ts`).
- **Repo-root clutter:** `_to_delete/`, `spike/`, `tmp-types-m4.ts`, `E2EV1.pen`.

- **No migration grants a table privilege, so a fresh Supabase project cannot run this schema**
  (`I43.2`, found 10 Sep, **confirmed**). Production works on a default the current CLI no longer
  applies; a new project gives `authenticated` only `Dxtm`, so every read is `42501` with RLS never
  consulted. **`verify.sh` cannot see it** — `local-stub.sql` sets the default privileges itself, so
  the pgTAP suite has always run against grants the schema never asks for. Stand-in at the head of
  `supabase/seed.sql`; the real fix needs an ADR because four narrowings are deliberate and the
  revoke order decides whether the audit log stays append-only.

## Suspected — carried from the 25 Aug audit, NOT re-verified

Treat as leads, not facts. Check before acting.

- ~~`sub_task_request_changes` may be missing a tenant fence.~~ **Closed 27 Aug** — the fence was
  added in `20260827100000` (marked EDIT 1 in the function) and is still there in the ADR-0059
  re-emission.
- pgTAP may cover only about a third of RLS policies (reported 36/104).
- `rates` column protection (L1.6) appears to have no test.


## Operational log — not included

The private copy of this file continues with two sections, *Waiting on Edward* (open product
decisions) and *In flight right now* (the day-by-day log of branches, pushes, deploys and
production clean-ups). They are operational records of a live deployment and are omitted from this
public portfolio copy. The engineering they record is in the ADRs (`docs/adr/`) and the tracker
(`docs/TASKS.md`).
