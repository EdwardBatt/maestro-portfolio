# End-to-end test plan — the local stack, every scenario, every notification

The plan an independent CLI (or a person) runs against the **seeded local stack** to prove
`docs/RETEST-REDESIGN.md` end to end, with the fixtures that make every scenario reachable and the
email path simulated so nothing leaves the machine. Written 14 Sep; the retest script stays the
step-by-step checklist, this is the harness around it.

Three parts: **(1)** the environment and the fixture set, **(2)** the scenario → fixture → assertion
map for sections A–N, **(3)** the notification and email matrix. Then how to run it.

---

## 1. Environment

| Piece | What | Where |
|---|---|---|
| Supabase local | Postgres + PostgREST + GoTrue + Realtime + Mailpit | `supabase start` · API 54321 · DB 54322 · Studio 54323 · **Mailpit 54324** |
| The seed | every account, office, department, team, client and campaign below | `supabase/seed.sql`, applied by `supabase db reset` |
| Edge Functions | AI, email, transitions | `supabase functions serve --env-file supabase/functions/.env` |
| The app | Vite dev server | `npm run dev` (Playwright starts it) |
| Playwright | local config, per-role sessions, two helpers, exemplar specs | `playwright.local.config.ts`, `e2e/local/` |

### Email, simulated — nothing reaches Resend

`supabase/functions/.env` carries:

```
EMAIL_TRANSPORT=mailpit
MAILPIT_URL=http://host.docker.internal:54324
```

With that, `notify-email` and `report-error` post to the local Mailpit's send API instead of
Resend (`supabase/functions/_shared/email-transport.ts`). Every notification email and every
"Report to your administrator" email lands at **http://127.0.0.1:54324**, readable by a person and
queryable by a test (`e2e/local/helpers/mailpit.ts`). Auth emails (invites, password resets) land
there regardless, through GoTrue. `EMAIL_ALLOWLIST` still applies on top; every seeded address is a
plus-tag of `maestro.dev@example.test`, which the allowlist normalises.

The database side needs two Vault secrets so its enqueue trigger knows where the Edge runtime is
(`project_url`, `notify_email_bearer`). **The seed writes them**, so a `db reset` is enough. Before
14 Sep they were absent locally and no notification was ever emailed here.

### Reset discipline

`supabase db reset` rebuilds the database from every migration plus the seed. It **wipes everything
created since** — single jobs, closures, bookings. Run it before a full pass; re-run `auth.setup`
after it (a saved session from before a reset is the stale-token trap). **Sign in fresh in the
browser after any reset.**

A table created by a later `migration up` (without a reset) has no table grant until one is added —
`traps.md`, "403 with RLS never consulted".

---

## 2. The fixture set (`supabase/seed.sql`)

All logins `maestro.dev+<tag>@example.test` / `devpassword`. `e2e/local/fixtures.ts` is the same list
for specs.

### People

| tag · login (password `devpassword`) | name | role | department / team | office | why it exists |
|---|---|---|---|---|---|
| `admin` · `maestro.dev+admin@example.test` | Dev Admin | Power Admin | — | Baghdad | failsafe everywhere; declares closures; edits settings |
| `traffic` · `maestro.dev+traffic@example.test` | Dev Traffic | Traffic Manager | — | Baghdad | tenant-wide scheduler; `clients:manage`; failsafe approver |
| `am` · `maestro.dev+am@example.test` | Dev Account Mgr | Account Manager | — | Baghdad | AM of Northwind + Harbour Line |
| `am2` · `maestro.dev+am2@example.test` | Dev Account Mgr 2 | Account Manager | — | Baghdad | AM of Luma Retail only — reach is own accounts |
| `ad` · `maestro.dev+ad@example.test` | Dev Account Dir | Account Director | — | Baghdad | G4 approver by set reach (ADR-0073) |
| `ceo` · `maestro.dev+ceo@example.test` | Dev CEO | CEO | — | Baghdad | read-only landing / leakage (L5) |
| `lead` · `maestro.dev+lead@example.test` | Dev Dept Lead | Department Lead | Creative | Baghdad | a department WITH a lead (B5) |
| `tl` · `maestro.dev+tl@example.test` | Dev Team Lead | Team Leader | Creative / Design | Baghdad | owner of two seeded deliverables |
| `motiontl` · `maestro.dev+motiontl@example.test` | Dev Motion Lead | Team Leader | Creative / Motion | Baghdad | **second** TL in Creative — F6 "one of THEIR team leads" |
| `deputy` · `maestro.dev+deputy@example.test` | Dev Deputy Lead | Deputy TL | Creative / Design | Baghdad | stands in (ADR-0017) |
| `maker` · `maestro.dev+maker@example.test` | Dev Maker | Team Member | Creative / Design | Baghdad | the non-manager (A5, H5, M8, N7); My Work (K) |
| `animator` · `maestro.dev+animator@example.test` | Dev Animator | Team Member | Creative / Motion | Baghdad | **locale `ar`** (L4); cross-team target for a TL |
| `content` · `maestro.dev+content@example.test` | Dev Content Lead | Department Lead | Content | Baghdad | second department with a lead |
| `copytl` · `maestro.dev+copytl@example.test` | Dev Copy Lead | Team Leader | Content / Copy | Baghdad | |
| `writer` · `maestro.dev+writer@example.test` | Dev Writer | Team Member | Content / Copy | Baghdad | cross-department booking target (I3) |
| `studiotl` · `maestro.dev+studiotl@example.test` | Dev Studio Lead | Team Leader | Production / Studio | Baghdad | **Production has NO lead** — B6 offers its two TLs |
| `edittl` · `maestro.dev+edittl@example.test` | Dev Edit Lead | Team Leader | Production / Edit | Baghdad | the second Production TL |
| `producer` · `maestro.dev+producer@example.test` | Dev Producer | Team Member | Production / Studio | Baghdad | |
| `editor` · `maestro.dev+editor@example.test` | Dev Editor (Dubai) | Team Member | Production / Edit | **Dubai** | M4 — a row in another office, Mon–Fri week |
| `planner` · `maestro.dev+planner@example.test` | Dev Planner | Team Member | Strategy | Baghdad | **Strategy has no lead and no TL** — B6's "still captures the job" |

### Structure

- **Offices:** Baghdad (Sun–Thu, Asia/Baghdad) · **Dubai (Mon–Fri, Asia/Dubai)**.
- **Departments:** Creative (lead, 2 teams, 2 TLs) · Content (lead, 1 team, 1 TL) · **Production (no
  lead, 2 teams, 2 TLs)** · **Strategy (nobody senior)**.
- **Clients:** Northwind Beverages (AM `am`, brand Northwind) · Harbour Line Logistics (AM `am`) ·
  Luma Retail (AM `am2`) · **Orphan Trading (no AM)**.
- **Campaigns:** *Northwind Summer Launch* — approved, go-live +42d, four deliverables (Key visual
  and Social launch films → `tl`; Social statics → `lead`; Launch copy and captions → `content`) ·
  *Harbour Line Rebrand* — pending approval, one deliverable.
- **Not seeded on purpose:** bookings, single jobs, closures, department briefs, concepts. Every
  test creates what it exercises through the product, so the product is what is tested.

---

## 3. Scenario map — `docs/RETEST-REDESIGN.md` A–N

For each step: who, what fixture, what is asserted, and what it leaves behind. Selectors are
`data-testid` only (bilingual app). "→ notif" names the row/email the step must produce (§4).

### A — The one way in
| Step | As | Fixture | Assert |
|---|---|---|---|
| A1–A3 | `admin`, `traffic`, `am` | — | Ctrl/Cmd+P opens the door (two choices); `/campaigns` + New; each choice routes |
| A4 | `am` | agency as client | no separate internal-project door |
| A5 | **`maker` and `writer`** (the retest said "content" — that account is a lead) | — | the non-manager message, not the print dialog |
| A6 | `am` | — | shortcut claimed with focus in a text field |

### B — Single job: the request
| Step | As | Fixture | Assert |
|---|---|---|---|
| B1 | `am` | — | the error NAMES each missing field |
| B2–B3 | `am` | — | free-text asker; typed due date |
| B4 | `am` | a PNG receipt; **needs OpenAI key** for the read | arrival read + confirmed, persists across Next/Back/reload; manual arrival without screenshot too |
| B5 | `am` | Creative | `lead` named as owner with Creative's due-week load |
| B6 | `am` | **Production** | offered `studiotl` and `edittl`; release blocked until one chosen. **Strategy** → captured, no owner offered |
| B7 | `am` | a booking in the due week on `maker` (make one on `/schedule` first) | capacity for the DUE week, not this week |

### C — Single job: the brief
| C1 | `am` | — | `single_execution` fields |
| C2–C3 | `am` | pasted brief text; **OpenAI** | "Reading the document…" modal; Keep markers; Next→review modal until all kept |
| C4 | `am` | — | only The Task mandatory |
| C5 | `am` | a small file; **B2 keys** or expect the soft-fail wording | filed into References |

### D — Review & release
| D1–D2 | `am` | — | one press: released + approved; "Releasing…" modal. **→ notif `campaign_approved` to the owner**, deep-linked to the DELIVERABLE (single job) |
| D3 | `am` | — | brief approved with the job |
| D4 | `am` | — | Cancel leaves it under Drafts |

### E — Duplicate check & the extra doors
| E1 | `am` | release a second job with a near-identical title | similar-jobs list; attach or proceed. **Attach → notif `deliverable_added` to the target's owner** |
| E2 | `am` | a released single job | Promote → campaign page; "Promoting…" modal (H9) |
| E3 | `am` | Orphan Trading | Add brand inline |

### F — Task list & ownership
| F1 | `traffic` | released job | tasks held; "awaiting the owner's review" |
| F2 | `am` | — | NO Approve-task-list button |
| F3 | `lead` (owner) | — | approves; tasks assignable |
| F4 | `admin` / `traffic` | — | failsafe approves |
| F5 | `lead` | a Production deliverable | Change owner: no "Nobody"; Production offers `studiotl`/`edittl` |
| F6 | `lead` | Social statics | reassign to **`motiontl`** (their own TL); `writer` never offered. **→ notif `deliverable_reassigned` to old AND new owner, never the actor** — the exemplar in `e2e/local/notifications.spec.ts` |

### G — Full campaign
| G1 | `am` | Northwind, brand Northwind | wizard end to end; every deliverable has an owner |
| **G1a** | `am` | go-live on a **Sunday**; a closure declared first (M2) | Due = Wednesday before; dates step over the closure; intro states the settings' numbers |
| **G1b** | `am` | due one working day before go-live | *Tight.* line with the arithmetic; Next works; go-live day → *Impossible*; after → refused with the named line. After submit: `sla_events` `due_date_override` for that deliverable (`helpers/db.slaEvents`) |
| G2 | `am` | a draft | resumes at the step it left |
| G3 | `am` | Northwind Summer Launch | page = wizard step 5 |
| G4 | `content`, `am`, `copytl`, `traffic`, `admin`, `ad` each | Content tab; **OpenAI** for generation | each can approve; `am2` and `maker` are NOT listed. **→ notif `brief_awaiting_approval` to the approvers** |
| G5 | `maker` | — | no propose/generate controls |

### H — The campaigns list
| H1–H3 | `am` | — | search by name/brand/client; header wording; Actions column |
| H4 | `am` | — | brief status, AM, department-brief progress, owners, go-live day |
| H5 | `maker`, `ceo` | — | list visible, no New/Promote/Discard/Close-out |
| H6–H7 | `am` | Northwind (work open) then a campaign whose deliverables are all approved | refused with count; then closes; "Show closed" + Reopen |
| H8 | `am` | a draft with a filed document | discard refused plainly |
| **H9** | `am` | — | "please wait" modals on Promote / Close out / Reopen |

### I — Scheduling & bookings
| I1 | `traffic` | — | New/Edit booking + request dialogs close on Esc/outside |
| I2 | `traffic` | Northwind task → `maker` | booking + assignment in one; **→ notif `assigned` to `maker`** (+ email) |
| I3 | `tl` | assign to **`writer`** (Content) | becomes a REQUEST; **→ notif `assignment_requested` to `content` and `copytl`**; `content` approves → `assignment_approved` to `tl`; refuse path → `assignment_refused`; second answer → `assignment_superseded` |
| I4 | `maker` then `am` | an assigned task | ask for time → **`extension_requested` to `am`**; approve/refuse → **`extension_approved` / `extension_refused` to `maker`**; K7's buffer from settings |
| I5 | `traffic` | drag a chip | span kept; **→ notif `rescheduled` to the assignee** |
| I6 | `tl` (in reach) / `tl` on `writer` (out of reach) | — | ad-hoc toggle present / absent |

### J — Review cycle
| J1 | `tl` | a task with reviewers `lead` (required) + `copytl` (optional) | one required; several unmarked refused |
| J2–J4 | `maker` submits; `copytl` answers; `lead` approves / requests changes | **→ `review_requested` to both reviewers; `feedback_collected` to `lead` when the optional answer lands; `changes_requested` / `signed_off` to `maker`** |
| J3 | `tl` | appoint `motiontl` after submit | **→ `review_requested` to `motiontl`** |

### K — My Work & deliverables
| K1–K2 | `maker` | assigned tasks | Start/Submit, timer, Completed panel |
| K3 | `maker` / `lead` | a small image; **B2** for the upload, or assert the plain failure (L3) | version, pin, request changes |
| K4 | `lead` | all tasks approved | container closes (ADR-0077) |
| K5 | `am` | archive a job | **→ `cancelled` to each assignee**; reinstate → `task_reinstated` |
| **K6** | `am` | Northwind deliverable, a file as evidence | Change promised date: tight/impossible WITH hours; save → date changed + `due_date_override` row; after go-live refused |
| **K7** | `maker` then `admin` | set review buffer 1 → 3 in M1 | the same requested day reads differently |

### L — Cross-cutting
| L1 | `maker` | stop `functions serve`, press Propose | "Report to your administrator" → **email to `admin` in Mailpit** (`report-error`) |
| L2 | various | every long action in the retest | the blocking modal |
| L3 / L3a | various | — | "That did not work" heading + plain copy; every dialog closes on Esc/outside |
| L4 | **`animator`** (locale `ar`) and the toggle | — | RTL mirrors; no raw keys (`/^[a-z0-9_.]+$/` never renders); tabular numbers |
| L5 | every tag in `fixtures.ts` | — | lands on its route; foreign-role controls `toHaveCount(0)` |
| L6 | — | keys present | B4, C2 and an email all succeed |

### M — Scheduling rules & closures — `e2e/local/closures.spec.ts` covers M2/M3/M4/M7
| M1 | `admin` then `traffic` | — | section shows 2/4/1; save; reload holds; `traffic`'s save fails plainly |
| M2–M3 | `admin` | Baghdad, two days next week | row with office; stranded panel; nothing moved; "What's booked on it" |
| M4 | `admin` | `producer` (Baghdad) vs `editor` (Dubai) rows | closed cells `nonworking` on Baghdad, not Dubai; column collapses only when every shown office is closed |
| M5 | `admin` | invite a new person into Baghdad after M2 (**Mailpit** gets the invite) | their row shades too |
| M6 | `traffic` | "3 days" on `maker` starting the day before the closure | lands before and after, never on it; a task spanning it skips it |
| M7 | `admin` | — | leave Type = Leave only |
| M8 | `maker` | — | no + buttons; table visible; stranded list read-only |

### N — The single refined concept (**OpenAI key required**)
| N1 | `lead` | Northwind, Creative tab, brief generated (G4) | "Proposing…" modal; one concept, three groups, no content types |
| N2–N4 | `lead` | — | Keep tag; Delete opens slots; "Regenerate removed (n)"; new items only in the gaps; kept items byte-identical; audit line |
| N5–N6 | `lead` | reload | one concept; discard two-step |
| N7 | `maker` | — | read-only |
| N8 | `content` | a department with a blank brief (Content, before G4) | the state line, not an error dialog |

### O — A manual note can carry a link (ADR-0059 addendum, I48.29) — `o-manual-link.spec.ts`
| O1 | `am` → `lead` → `traffic` → `maker` | a Creative single job, list approved, first task booked on `maker` in **manual** mode, `lead` required | a link alone does not enable Add note; note + link posts; the maker sees the link as a link (host + path, new tab); Submit; `review_feedback.link_url` stored |
| O2 | `lead` | — | the link on the note in Awaiting my review; the offline sentence absent for the reviewer; approve → `done`. `GUIDE_SHOTS=1` writes guides 7/8's two images |

### P — Capture by a colleague; the owner adds a task (I48.38–I48.42, ADR-0083 addendum) — `p-capture-and-add-task.spec.ts`
| P1 | `am2` (not Northwind's AM) → `am` | a Northwind job with a screenshot; B2 mocked slowly | please-wait on Next; receipt + asset saved; Approve refused NAMING `am`, no Report; `am` resumes and approves |
| P2 | `lead`, then `content` | a released Creative job | the owner adds an unassigned task (department = Creative); the Content lead is refused in words, no Report |
| P3 | `lead` | `save_sub_task` answered 500 on the wire; `report-error` intercepted | the dialog offers Report; the report carries `code` and the cause (message + detail) |

---

## 4. Notification and email matrix

Every type the database allows, what fires it, who receives it, and where the plan exercises it.
For each: assert the **row** (`helpers/db.waitForNotification(email, type)` — written in the same
transaction as the action, addressed to the recipient, **never to the actor**), the **inbox**
(`notif-badge`, `notif-<id>` in a fresh page for that person — the live push is `I48.17`, parked),
and the **email** (`helpers/mailpit.expectMail(email, subject)`; `expectNoMail` for the actor).

| Type | Fired by | To | Step | Email |
|---|---|---|---|---|
| `assigned` · `maestro.dev+assigned@example.test` | assigning a task (booking made) | assignee | I2 | yes |
| `assignment_requested` | booking outside your reach | the leads who may answer | I3 | yes |
| `assignment_approved` / `_refused` | a lead answers | the requester | I3 | yes |
| `assignment_superseded` | a second lead answers / the job is attached | the requester | I3 / E1 | yes |
| `rescheduled` · `maestro.dev+rescheduled@example.test` | a chip is dragged | assignee | I5 | yes |
| `resource_clash` | an exclusive resource double-booked | the booker | I (equipment — book the seeded camera twice) | yes |
| `resource_required` | a task names a required resource | resource's booker | I (task resources editor on `/deliverables`) | yes |
| `review_requested` | submit; a reviewer appointed after submit | reviewers | J2, J3 | yes |
| `feedback_collected` | the last optional answer lands | required reviewer | J4 | yes |
| `changes_requested` | reviewer sends back | assignee | J4 | yes |
| `signed_off` | task approved / deliverable signed off | assignee / owner | K4 | yes |
| `campaign_approved` | release / approve | deliverable owners (single job: → deliverable) | D2, G1 | yes |
| `brief_awaiting_approval` | department brief generated | its approvers | G4 | yes |
| `deliverable_added` | job attached to a campaign | target's owner | E1 | yes |
| `deliverable_reassigned` | owner changed | old and new owner | F6 — **exemplar spec** | yes |
| `extension_requested` | assignee asks | the AM | I4 | yes |
| `extension_approved` / `_refused` | AM answers | assignee | I4 | yes |
| `blocked` · `maestro.dev+blocked@example.test` | deliverable blocked (transition) | owner | K (block a deliverable) | yes |
| `cancelled` · `maestro.dev+cancelled@example.test` | job archived / task cancelled | assignee | K5 | yes |
| `task_reinstated` | cancelled task reinstated | assignee | K5 | yes |
| `dependency_ready` | the task this one waits for is done | assignee | K (a required input satisfied) | yes |
| `chat_added` | added to a conversation by name | the person | chat panel on a deliverable | yes |
| `due_soon` | the reminder sweep (scheduled, `CRON_SECRET`) | assignee | run the sweep function by hand | **no — digest only** |
| `report-error` (not a notification) | "Report to your administrator" | Power Admins | L1 | yes — the only email with no row |

**Invite / password reset** emails come from GoTrue and land in Mailpit without any of this — M5
uses one.

---

## 4b. The coverage gate (I49, 15 Sep)

`node scripts/check-e2e-coverage.mjs` lists every interactive control in `src/` (by `data-testid`)
that no spec under `e2e/` presses. `--gate` (CI, `npm run check:e2e-coverage`) fails on any control
not already in `e2e/coverage-baseline.json` — the backlog snapshot, one line per screen in
`TASKS.md` `I49`. Clear a screen's controls, then `--write-baseline` to shrink the backlog. A spec
that presses `${prefix}-save` over many prefixes does not count as covering anything; press the id.

The burn-down lives in `e2e/local/coverage/`, **one spec per screen**, and every one follows the
pattern of `deliverables-page.spec.ts`: one person who MAY and one who MAY NOT for every control;
the outcome read back from the database, not just from the screen; a refusal worded, with no Report;
every "Done" dialog closed and asserted to be a success. A defect the spec finds is logged under
`I49` and, if it cannot be fixed in the same session, held as `test.fixme` with its ID so the
section stays green and the gap stays visible.

## 5. Running it

```bash
supabase start                                          # once
supabase db reset                                       # every full pass — seeds everything above
supabase functions serve --env-file supabase/functions/.env   # keep running (EMAIL_TRANSPORT=mailpit)
npm run e2e:local                                       # auth.setup for every role, then the specs
npm run e2e:local -- closures                           # one family
npx playwright show-report                              # after a failure
```

- **Order and isolation.** One worker, file order. Each family creates what it needs through the
  product and removes it after (`afterAll`), or says what it leaves. A family that needs a clean
  slate says so and the runner resets first.
- **Sessions.** `e2e/.auth/<tag>.json` per person, from `auth.setup.ts`. Re-run after every reset.
- **Model-dependent steps.** C2/G4 are mocked at the network edge (the fields come back after a
  delay, so the busy modal is seen); L6 and every N step call the real model and need
  `OPENAI_API_KEY` in the env file. **Storage-dependent** steps (C5, K3, K6) mock the two presign
  functions and the bucket (`mockBucket` in `k-my-work.spec.ts`): the product's own row writes
  (`media_records`, `assets`) still happen against the real database; only the bytes never leave.
- **Long-lived local database.** The specs are written to be re-run without a reset (unique titles,
  entity-scoped notification waits, settings and closures put back), but the seeded people
  accumulate jobs and bookings across runs. `supabase db reset` before a run that is meant to be
  read as a whole.
- **Read-back** is via PostgREST as the service role (`helpers/db.ts`) and Mailpit's API
  (`helpers/mailpit.ts`) — for assertions only, never to set up state.
- **Mailpit** is cleared at the start of each family that asserts on mail.

### What exists

`e2e/local/retest-redesign/` holds one spec per section, A–N (`a-one-way-in` … `n-single-concept`),
run in file order by `npm run e2e:local` after `auth.setup.ts` signs every role in. The helpers:
`helpers/db.ts` (service-role reads, `waitForNotification(email, type, timeout, entityId)`,
`attemptWrite` for proving a database refusal), `helpers/mailpit.ts`, `helpers/single-job.ts`
(fill → review → approve → release, lookalike prompt handled). The two earlier exemplars,
`closures.spec.ts` and `notifications.spec.ts`, remain. `docs/RETEST-REDESIGN.md` is the human
walkthrough and the source of the step numbers; the 14 Sep run ticked all 87 items and found
I48.21–I48.28 along the way (I48.24 became ADR-0093).
