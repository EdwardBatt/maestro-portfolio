# Redesign test script — full walk (intake, campaigns, scheduling, review)

The end-to-end test for the redesign (ADR-0082 → 0092) and the work around it, revised for the
**second 13 Sep pass** — the five scheduling items (`I41.8`–`I41.12`), the single refined concept
(`I48.15`) and the three ADR-0092 polish passes (`I48.8`, `I48.10`, `I48.12`). Walk it in order;
tick each step as you confirm it. Items that **changed in this pass** are marked **[new]** so you can
focus there; items from the first 13 Sep pass are marked **[13 Sep]**; everything else is a
regression check.

**Before you start**
- The local database already has every migration through `20260913180000` applied (`supabase
  migration up` ran at the end of the build). If you `db reset` instead, that also works. Serve the
  Edge Functions with the env file (AI, email, error reporting) — **restart `supabase functions
  serve`** so the rewritten `propose-concepts` is picked up. **Sign in fresh after any reset**
  (stale-token trap).
- **Seed rebuilt 14 Sep** — every account and structure the steps below name is now in
  `supabase/seed.sql` (who is for what: `docs/E2E-PLAN.md` §2). All twenty logins:

| Login (password `devpassword`) | Who | Role | Department / team | Office |
|---|---|---|---|---|
| `maestro.dev+admin@example.test` | Dev Admin | Power Admin | — | Baghdad |
| `maestro.dev+traffic@example.test` | Dev Traffic | Traffic Manager | — | Baghdad |
| `maestro.dev+am@example.test` | Dev Account Mgr | Account Manager (Northwind, Harbour Line) | — | Baghdad |
| `maestro.dev+am2@example.test` | Dev Account Mgr 2 | Account Manager (Luma Retail) | — | Baghdad |
| `maestro.dev+ad@example.test` | Dev Account Dir | Account Director | — | Baghdad |
| `maestro.dev+ceo@example.test` | Dev CEO | CEO (read-only) | — | Baghdad |
| `maestro.dev+lead@example.test` | Dev Dept Lead | Department Lead | Creative | Baghdad |
| `maestro.dev+tl@example.test` | Dev Team Lead | Team Leader | Creative / Design | Baghdad |
| `maestro.dev+motiontl@example.test` | Dev Motion Lead | Team Leader | Creative / Motion | Baghdad |
| `maestro.dev+deputy@example.test` | Dev Deputy Lead | Deputy Team Leader | Creative / Design | Baghdad |
| `maestro.dev+maker@example.test` | Dev Maker | Team Member | Creative / Design | Baghdad |
| `maestro.dev+animator@example.test` | Dev Animator | Team Member (Arabic locale) | Creative / Motion | Baghdad |
| `maestro.dev+content@example.test` | Dev Content Lead | Department Lead | Content | Baghdad |
| `maestro.dev+copytl@example.test` | Dev Copy Lead | Team Leader | Content / Copy | Baghdad |
| `maestro.dev+writer@example.test` | Dev Writer | Team Member | Content / Copy | Baghdad |
| `maestro.dev+studiotl@example.test` | Dev Studio Lead | Team Leader | Production / Studio (**no dept lead**) | Baghdad |
| `maestro.dev+edittl@example.test` | Dev Edit Lead | Team Leader | Production / Edit | Baghdad |
| `maestro.dev+producer@example.test` | Dev Producer | Team Member | Production / Studio | Baghdad |
| `maestro.dev+editor@example.test` | Dev Editor (Dubai) | Team Member | Production / Edit | **Dubai** |
| `maestro.dev+planner@example.test` | Dev Planner | Team Member | Strategy (**nobody senior**) | Baghdad |

- Departments: **Creative** (lead `lead`, TLs `tl` + `motiontl`), **Content** (lead `content`, TL
  `copytl`, member `writer`), **Production (NO lead — TLs `studiotl` + `edittl`)**, **Strategy
  (nobody senior)**. Offices: Baghdad (Sun–Thu) and **Dubai** (`editor`, Mon–Fri). Clients:
  Northwind, Harbour Line, Luma Retail (`am2`), **Orphan Trading (no AM)**.
- **Email is simulated:** with `EMAIL_TRANSPORT=mailpit` in `supabase/functions/.env`, every
  notification email and error report lands in Mailpit at http://127.0.0.1:54324 — nothing goes to
  Resend. A `db reset` also installs the two Vault secrets the email queue needs locally.
- **Automated run:** `e2e/local/retest-redesign/<a–n>-*.spec.ts`, one file per section, run with
  `npx playwright test e2e/local/retest-redesign/<file> -c playwright.local.config.ts`. A tick below
  means the spec passed; an unticked item with an `Error:` line under it is a genuine
  application/backend failure the spec found — never a test-script fault.

---

## A — The one way in (ADR-0082)

- [X] **A1** As a manager (admin/traffic/am), press **Ctrl/Cmd+P** anywhere → the new-request door
  opens with two choices: a single job and a full campaign.
- [X] **A2** The door is also reachable from **`/campaigns` → + New**.
- [X] **A3** "Full campaign" opens the existing brief wizard; "single job" opens the single-job flow.
- [X] **A4** Internal work comes through the **same door** (agency as the client) — there is no
  separate "+ New internal project".
- [X] **A5 [13 Sep]** As a **non-manager** (`maker`, or `writer` in Content), press Ctrl/Cmd+P → a message, not the
  browser print dialog: **"Projects are created by an account manager / Ask an Account Manager to
  create the project for you — or, if it is an internal project, request the required permissions."**
- [X] **A6** Ctrl/Cmd+P is claimed even when focus is in a text field (no browser Print).

## B — Single job: the request (SJ-02, ADR-0083)

- [X] **B1 [13 Sep]** Press **Next** with required fields blank → the error **names each missing
  field**: "Fill in these required fields before moving on: Job title, Client, What they asked
  for…, Due date, Which department." (Not the generic "fields marked *".)
- [X] **B2** "Who asked" is free text; the client's words are captured verbatim.
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).not.[22mtoHaveAttribute[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('sj-asked-by')
    Expected pattern: not [32m/.+/[39m
    Received string: [31m"[7msj-asked-by-people[27m"[39m
    Timeout: 10000ms
    
    Call log:
    [2m  - Expect "not toHaveAttribute" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('sj-asked-by')[22m
    [2m    22 × locator resolved to <input value="" list="sj-asked-by-people" data-testid="sj-asked-by" placeholder="A name — a client contact, or somebody down the corridor."/>[22m
    [2m       - unexpected value "sj-asked-by-people"[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoHaveAttribute[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator:  getByTestId('sj-asked-by')
    Expected: [32m"text"[39m
    Received: [31m""[39m
    Timeout:  10000ms
    
    Call log:
    [2m  - Expect "toHaveAttribute" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('sj-asked-by')[22m
    [2m    20 × locator resolved to <input value="" data-testid="sj-asked-by" placeholder="A name — a client contact, or somebody down the corridor."/>[22m
    [2m       - unexpected value "null"[22m
    
</details>
- [X] **B3** The due date is **typed** — there is no proposed date.
- [X] **B4** Paste/attach the brief receipt (screenshot): the arrival time is **read and confirmed**,
  the clock starts from it, and it persists across Next/Back and a reload (including a **manual**
  arrival with no screenshot).
- [X] **B5** Pick a department **with a lead** (Creative) → the lead is named as the owner, with the
  department's load for the **due** week.
- [X] **B6 [13 Sep]** Pick **Production (no lead)** → you are offered Production's **team leads** as
  owner with "… has no department lead yet — name a team lead as the owner"; release is **blocked**
  until one is chosen. (A department with neither lead nor team lead still captures the job.)
- [X] **B7** Capacity shown is for the week the work is **due**, not the current week.

## C — Single job: the brief (SJ-03, ADR-0084)

- [X] **C1** The brief shows the `single_execution` fields, empty, with guidance.
- [X] **C2 [13 Sep]** Ingest a brief (paste or upload) → a blocking **"Reading the document…"** modal
  shows, then the top message reads **"Filled N fields from the brief — review or edit each field,
  then click 'Keep' to confirm."**
- [X] **C3 [13 Sep]** Each machine-filled field shows a **Keep** marker. With any unconfirmed, clicking
  **Next → review** opens a modal: **"All brief fields must be confirmed by clicking 'Keep' …"**.
  Keep/edit each, then Next advances. (The old "Two fields still empty" footnote is gone.)
- [X] **C4** "What could stop this" is optional (amber "still empty" nudge only); the only mandatory
  field is **The Task**.
- [X] **C5** Attachments file into the job's References folder. (Filing needs Assets + B2 config;
  locally without B2 it fails softly and the job still proceeds.)

## D — Single job: review & release (SJ-04, ADR-0085)

- [X] **D1** The review shows the request, the brief, and where it lands (department + owner).
- [X] **D2** **Approve** releases in one press: completes the draft (stream, deliverable, held task
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('sj-busy-release')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('sj-busy-release')[22m
    
</details>
  list) and approves it; the owner is notified; a blocking "Releasing…" modal shows.
- [X] **D3** The single-execution brief is approved with the job (the department writes no second
  brief for a single job).
- [X] **D4** Cancel leaves the job under **Drafts** on the campaigns list and says so.

## E — Duplicate check & the extra doors (ADR-0086)

- [X] **E1** On approve, the **similar open jobs** check runs; if it matches, you are shown them
  (SJ-A1) and can attach or proceed. If the check can't run, release is **not** blocked.
- [X] **E2** **Promote** (SJ-A2) on a released single job flips it to a campaign and opens the
  campaign page (not the wizard). One-way; the dialog says so.
- [X] **E3** **Add brand** (SJ-A3) from the request adds a brand inline.

## F — Task list & ownership (ADR-0090 + ADR-0083 d.9/d.11/d.12)

- [X] **F1** A released single job's tasks are **held** until the owner approves the list — they are
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('task-list-held')
    Expected pattern: [32m/awaiting the owner's review.*Dev Dept Lead/[39m
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('task-list-held')[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeGreaterThan[2m([22m[32mexpected[39m[2m)[22m
    
    Expected: > [32m0[39m
    Received:   [31m0[39m
</details>
  not assignable and show "awaiting the owner's review" on the unassigned surfaces.
- [X] **F2 [13 Sep]** As the **account manager**, open the deliverable → there is **no "Approve task
  list"** button. (The AM approves the campaign, not the department's task list.)
- [X] **F3** As the **department lead (owner)**, the "Approve task list" button appears and works;
  after approval the tasks are assignable.
- [X] **F4** The failsafe — Power Admin / Traffic — can approve for an absent owner.
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('task-list-held')
    Expected substring: [32m"Dev Studio Lead"[39m
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('task-list-held')[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('task-list-held')
    Expected substring: [32m"Dev Studio Lead"[39m
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('task-list-held')[22m
    
</details>
- [X] **F5 [13 Sep]** On the deliverable's **Change owner** there is **no "Nobody"**; ownership cannot
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeDisabled[2m([22m[2m)[22m failed
    
    Locator:  getByTestId('deliverable-owner-save')
    Expected: disabled
    Received: enabled
    Timeout:  10000ms
    
    Call log:
    [2m  - Expect "toBeDisabled" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('deliverable-owner-save')[22m
    [2m    23 × locator resolved to <button data-testid="deliverable-owner-save">Save</button>[22m
    [2m       - unexpected value "enabled"[22m
    
</details>
  be cleared. A department with no lead offers its **team leads** with the explanation.
- [X] **F6** The owner can reassign the deliverable to one of their **team leads** (within the
  department). A team member is never offered as an owner.

## G — Full campaign (brief wizard, end to end)

- [X] **G1** Create a campaign through the wizard: brief → deliverables (owner per deliverable,
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: locator('[data-testid^="wizard-deliverable-"][data-testid$=""]').filter({ has: locator('[data-testid^="wizard-deliverable-owner-"]') }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for locator('[data-testid^="wizard-deliverable-"][data-testid$=""]').filter({ has: locator('[data-testid^="wizard-deliverable-owner-"]') }).first()[22m
    
</details>
  never "Nobody") → departments → review → submit.
- [X] **G1a [new] — working-day offsets (I41.9)** — on the timing step the intro names the offsets
  from the settings ("delivery **2 working days** before go-live, work starting **4 working days**
  before that"). Set go-live to a **Sunday** → Due by lands on the **Wednesday** before (never the
  Friday), Commence by four working days before that. Set go-live to a date just after a declared
  closure (M2) → the dates step over the closed days too.
- [X] **G1b [new] — the due-date warning (I41.8)** — with go-live set, type a due date **one working
  day** before it → an amber line under the field: **"Tight."** with the arithmetic ("1 working
  day(s) left before go-live; the rule asks for 2") and "You can proceed — the override is recorded."
  Next still works. Type the go-live day itself → **"Impossible as planned."** Type a date **after**
  go-live → a red line, and Next says **"A deliverable is due after the campaign goes live…"** and
  stays on the step. Submit with a tight date → `sla_events` for that deliverable carries a
  `due_date_override` row (severity, days left, who) — visible in Studio.
- [X] **G2** Resuming a draft opens where it was left (all steps, not just step 1).
- [X] **G3** On `/campaigns/:id` the campaign reads the same as wizard step 5: campaign brief, a tab
  per department, all deliverables.
- [X] **G4** Each department **generates and approves its own brief** on its tab (after campaign
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-task-lists-tasks-e93cf031-8b61-4e2c-9439-460a0a32b803').locator('li').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-task-lists-tasks-e93cf031-8b61-4e2c-9439-460a0a32b803').locator('li').first()[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).not.[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002')
    Expected pattern: not [32m/awaiting/i[39m
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "not toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002')[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved').or(getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-error'))
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved').or(getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-error'))[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved')[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approved')[22m
    
</details>
Error: <details>
Error: am2 may NOT approve
    
    [2mexpect([22m[31mlocator[39m[2m).[22mtoHaveCount[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator:  getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approve')
    Expected: [32m0[39m
    Received: [31m1[39m
    Timeout:  10000ms
    
    Call log:
    [2m  - am2 may NOT approve with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approve')[22m
    [2m    23 × locator resolved to 1 element[22m
    [2m       - unexpected value "1"[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-department-nobrief-d0000000-0000-4000-8000-00000000d002')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-department-nobrief-d0000000-0000-4000-8000-00000000d002')[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-department-nobrief-d0000000-0000-4000-8000-00000000d002')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-department-nobrief-d0000000-0000-4000-8000-00000000d002')[22m
    
</details>
Error: <details>
Error: am may approve
    
    [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approve')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - am may approve with timeout 10000ms[22m
    [2m  - waiting for getByTestId('campaign-brief-approval-d0000000-0000-4000-8000-00000000d002-approve')[22m
    
</details>
Error: <details>
Error: locator.selectOption: options[0].label: expected string, got object
</details>
  approval). The intended approvers (dept lead, the campaign's AM, team lead, Traffic, Power Admin,
  Account Director) can; uninvolved scope-grant holders are not listed.
- [X] **G5** `propose-concepts` / `generate-brief` run on demand behind `projects:manage`.

## H — The campaigns list (`/campaigns`, I40 + I48)

- [X] **H1 [13 Sep]** **Search** filters by **name / brand / client**; no match shows a one-line "No
  campaigns match …", not the empty CTA.
- [X] **H2 [13 Sep]** The status column header reads **"Campaign/Project brief"**.
- [X] **H3 [13 Sep]** The **Actions** column is populated: **Open** on every row; Promote/Resume for a
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBeGreaterThan[2m([22m[32mexpected[39m[2m)[22m
    
    Expected: > [32m1[39m
    Received:   [31m0[39m
</details>
  single job; **Close out** on an approved campaign.
- [X] **H4** The list shows brief status, account manager, department-brief progress (counted),
  owners, go-live (a day, no time).
- [X] **H5** **Read-only for non-managers**: the list is visible to all, but New/Promote/Discard/
  Close-out are managers only.
- [X] **H6 [13 Sep] — close-out (ADR-0091)** — on an approved campaign with a deliverable still in
  progress, **Close out** is refused with a plain message naming what's open. Once all deliverables
  are approved/archived, Close out succeeds and the campaign leaves the list.
- [X] **H7 [13 Sep]** Tick **"Show closed (N)"** → closed campaigns reappear with **Reopen**, which
  returns them to the active list.
- [X] **H8** Drafts are listed separately as unfinished; resume/discard work; a draft with documents
  filed refuses discard with a plain message.
- [X] **H9 [new] — please-wait (I48.8)** — Promote, Close out and Reopen each show a blocking
  "please wait" modal ("Promoting the job to a campaign…", "Closing out the campaign…", "Reopening
  the campaign…") for the duration.

## I — Scheduling & bookings (`/schedule`)

- [X] **I1 [13 Sep]** **New booking** dialog closes on **outside-click** and **Esc**. Same for **Edit
  booking** and the **assignment-request** dialog. Fields/validation unchanged.
- [X] **I2** Assigning a task to a person creates the booking and the assignment in one step; the
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoHaveCount[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator:  getByTestId('booking-dialog')
    Expected: [32m0[39m
    Received: [31m1[39m
    Timeout:  10000ms
    
    Call log:
    [2m  - Expect "toHaveCount" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('booking-dialog')[22m
    [2m    23 × locator resolved to 1 element[22m
    [2m       - unexpected value "1"[22m
    
</details>
  person is notified; capacity warnings show; working week and blackouts respected.
- [X] **I3 — booking requests (ADR-0087)** — assigning **outside your reach** becomes a **request
  the person's lead answers**; the dialog says so before submit; the lead approves/refuses.
- [X] **I4 — extensions (ADR-0088)** — a deadline is **extended by asking**; the account manager
  answers. An assignee asking for time does not take it until granted.
- [X] **I5** Multi-day tasks keep the span they were committed to; My Work shows today's tasks
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoHaveLength[2m([22m[32mexpected[39m[2m)[22m
    
    Expected length: [32m5[39m
    Received length: [31m7[39m
    Received array:  [31m[{"starts_at": "2026-10-18T06:00:00+00:00"}, {"starts_at": "2026-10-19T06:00:00+00:00"}, {"starts_at": "2026-10-20T06:00:00+00:00"}, {"starts_at": "2026-10-21T06:00:00+00:00"}, {"starts_at": "2026-10-22T06:00:00+00:00"}, {"starts_at": "2026-10-25T06:00:00+00:00"}, {"starts_at": "2026-10-26T06:00:00+00:00"}][39m
</details>
  correctly.
- [X] **I6 [13 Sep] — ad-hoc creation restored (I48.5)** — on a person in reach, the booking dialog
  offers a **Project task / Ad-hoc task** toggle. Ad-hoc collects a task name + a **reviewer** +
  hours/dates and creates the work (it appears on the person's My Work). An **out-of-reach** person
  shows no ad-hoc option — it stays project work that becomes a request (ADR-0087).

## J — Review cycle (ADR-0089)

- [X] **J1** A reviewed task has **one required reviewer** (appoint one → required by definition);
  several unmarked are refused.
- [X] **J2** Optional reviewers **answer** (no comment / feedback left) and do not approve; the
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('awaiting-review-respond-c460bb7d-a9f1-4383-94ba-08a503a227f2')
    Expected pattern: [32m/feedback left/i[39m
    Received string:  [31m"Done — no comment"[39m
    Timeout: 10000ms
    
    Call log:
    [2m  - Expect "toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('awaiting-review-respond-c460bb7d-a9f1-4383-94ba-08a503a227f2')[22m
    [2m    23 × locator resolved to <button type="button" class="btn-primary" data-testid="awaiting-review-respond-c460bb7d-a9f1-4383-94ba-08a503a227f2">Done — no comment</button>[22m
    [2m       - unexpected value "Done — no comment"[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('my-work-submit-8cc565db-a94c-4e65-96b3-62d76e558842')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('my-work-submit-8cc565db-a94c-4e65-96b3-62d76e558842')[22m
    
</details>
  required reviewer's approval is a hard wait on every optional answer.
- [X] **J3** A reviewer appointed after submit is notified; the ad-hoc reviewer picker can correct
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('my-work-submit-70b83986-4955-43ff-b0d0-cd3efcf42b87')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('my-work-submit-70b83986-4955-43ff-b0d0-cd3efcf42b87')[22m
    
</details>
  reviewers.
- [X] **J4** Request-changes round-trips; `feedback_collected` notifies the required reviewer when
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).not.[22mtoContainText[2m([22m[32mexpected[39m[2m)[22m failed
    
    Locator: getByTestId('task-review-gate-9eee0c70-ab53-4994-a315-6ba6857326b9')
    Expected pattern: not [32m/describe|note/i[39m
    Received string: [31m"Your [7mnote[27m for this round is written — you can submit."[39m
    Timeout: 10000ms
    
    Call log:
    [2m  - Expect "not toContainText" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('task-review-gate-9eee0c70-ab53-4994-a315-6ba6857326b9')[22m
    [2m    23 × locator resolved to <p class="muted" data-testid="task-review-gate-9eee0c70-ab53-4994-a315-6ba6857326b9">Your note for this round is written — you can sub…</p>[22m
    [2m       - unexpected value "Your note for this round is written — you can submit."[22m
    
</details>
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m
    
    Expected: [32m2[39m
    Received: [31m1[39m
</details>
Error: <details>
Error: db: no 'feedback_collected' notification for maestro.dev+lead@example.test within 8000ms
</details>
Error: <details>
Error: db: no 'feedback_collected' notification for maestro.dev+lead@example.test within 8000ms
</details>
  the last answer is in.

## K — My Work & deliverables

- [X] **K1** A maker's My Work lists assigned tasks with Start/Submit and a timer; today's tasks vs
Error: <details>
Error: db: task_time_entries?select=id,started_at,ended_at&sub_task_id=eq.7c6ad6bc-6b5f-441a-82f7-16543a0c67f5&user_id=eq.d0000000-0000-4000-8000-00000000a006 → 400 {"code":"42703","details":null,"hint":null,"message":"column task_time_entries.ended_at does not exist"}
</details>
  other tasks are correct.
- [X] **K2** The Completed panel renders finished work.
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m
    
    Expected: [32m"approved"[39m
    Received: [31m"in_progress"[39m
</details>
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m
    
    Expected: [32m"80ed7e95-512c-40c2-bd40-4b3385230a67"[39m
    Received: [31m"adaaf28f-2515-4c04-9b86-667cb1ea4cbd"[39m
</details>
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoBe[2m([22m[32mexpected[39m[2m) // Object.is equality[22m
    
    Expected: [32m"approved"[39m
    Received: [31m"draft"[39m
</details>
- [X] **K3** Internal review: version upload to B2, pinned/timecoded feedback, request-changes.
  (Automated run: B2 mocked locally — presign + PUT; the pin path on an image; timecoded feedback
  needs a video and is not covered by the local run.)
Error: <details>
Error: [2mexpect([22m[31mreceived[39m[2m).[22mtoHaveLength[2m([22m[32mexpected[39m[2m)[22m
    
    Expected length: [32m1[39m
    Received length: [31m0[39m
    Received array:  [31m[][39m
</details>
Error: <details>
Error: [2mexpect([22m[31mlocator[39m[2m).[22mtoBeVisible[2m([22m[2m)[22m failed
    
    Locator: getByTestId('review-version-f8e09ade-1252-415e-bb25-546289f3e58c')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found
    
    Call log:
    [2m  - Expect "toBeVisible" with timeout 10000ms[22m
    [2m  - waiting for getByTestId('review-version-f8e09ade-1252-415e-bb25-546289f3e58c')[22m
    
</details>
- [X] **K4** Task approval signs off; a container closes when its contents are done (ADR-0077).
- [X] **K5** Archiving a job calls off the work under it.
- [X] **K6 [new] — change the promised date (I41.8)** — on a campaign with a go-live, open a
  deliverable's **Change the promised date** dialog (it now closes on Esc / outside-click). Pick a
  date inside the window → the same tight/impossible line appears, now **with hours**: "Nh of work
  outstanding against Mh the days before it can hold" (N = the deliverable's open tasks'
  estimates). Save with evidence → the date changes AND an override is recorded. A date after
  go-live is still refused.
  (Automated run: the go-live day was refused by the server while the screen said "impossible —
  proceed and it is recorded". Decided 14 Sep as ADR-0093: no door refuses a date after go-live —
  it warns, names the client's agreement, and the override is recorded as `after_go_live`. K6b
  now proves the go-live day AND a later day both warn, save and record.)
- [X] **K7 [new] — extension requests read the settings (I41.10)** — ask for a task extension: the
  fine/tight/at-risk arithmetic uses the **review buffer from Admin → Organization → Scheduling
  rules** (change it to 3 and the same date reads differently) and skips declared closures.

## L — Cross-cutting

- [X] **L1 [13 Sep] — error reporting (ADR-0092)** — an error dialog carries **"Report to your
  administrator"**; clicking it sends the error + context to the tenant's Power Admins (email via
  Resend) and acknowledges "Sent" (or says plainly if no admin is reachable).
- [X] **L2 [new] — processing feedback (ADR-0092, I48.8)** — every long action shows a blocking
  "please wait …" modal: brief ingestion, release, concept proposal/regeneration, promote, close-out,
  reopen, writing the department briefs, approving a campaign, and every upload (Library, review
  versions, campaign documents).
- [X] **L3 [new] — plain errors (I48.10)** — force a failure (e.g. stop `functions serve` and press
  "Propose a concept"; or invite a user with the Edge runtime down). The dialog's heading is **"That
  did not work"** (never "Something went wrong"), and the message says what happened, what state
  things are in, and what to do ("…Nothing was changed — try again, or report this.").
- [X] **L3a [new] — one dialog chrome (I48.12)** — every dialog now closes on **Esc** and on a click
  outside, and focus lands inside it on open: invite user, new role, edit office, user permissions,
  resource, client form, leave, closure, send feedback, extension request, change promised date, the
  deliverable detail, the reassign confirmation, the schedule refusal, awaiting-review and My Work's
  review/submit modals. (The submit modal refuses to close while an upload is in flight.)
- [X] **L4 — RTL / Arabic** — switch to Arabic: layout mirrors, the new strings (owner picker,
  close-out, search, report button, field-list error) read correctly, numbers stay tabular.
- [X] **L5 — roles / landing** — each role lands on its route and sees only its surfaces (role
  leakage check). *(Default landing pages per role is a pending decision — see STATE.md.)*
- [X] **L6 — AI / email** — receipt model-read (B4), brief ingestion (C2) and notification emails
  all work against the configured keys.

## M — Scheduling rules and office closures (ADR-0075 d.5, ADR-0079; I41.10–I41.12) [new]

- [X] **M1 — the settings (I41.10)** — as admin, **Admin → Organization** has a **Scheduling
  rules** section at the top: Delivery before go-live (2), Commence before delivery (4), Review
  buffer (1), all in working days. Save is off until you change something; change 2 → 3 and save →
  "Scheduling rules saved." Reload: it holds. As Traffic (no `organization:manage`) the save fails
  plainly. The wizard's timing intro (G1a) now says 3. *(Put it back to 2 afterwards.)*
  (Automated run: Traffic cannot open Admin → Organization at all — `admin.organization:view` is
  the executives' and the Power Admin's — so the plain refusal is checked as the CEO. It WAS silent:
  the RLS-filtered update touched nothing and the page said "saved" — fixed, I48.26.)
- [X] **M2 — declare a closure (I41.11)** — as admin (or any `leave:manage` holder), **People →
  Leave**: the page has two halves, **Office closures** above **Staff leave**. Press **+ Declare a
  closure** → the form asks for an **office** (not a person), a kind (Public holiday / Company
  closed), a name, and dates (leave "To" blank for one day). Declare "Eid" on Baghdad for two days
  next week → the row appears with the office name.
- [X] **M3 — the stranded list (I41.12)** — straight after saving, a panel **"Work sitting on closed
  days — Eid"** lists every booking on Baghdad people over those days, with the work, the owner and
  **Open that week** (which opens `/schedule` on that week filtered to the person). If nothing is
  booked it says so. **Nothing has been moved** — check the bookings are exactly where they were.
  Drag one to a working day on the schedule: the drop warns as before and moves it. The same list
  is reachable later from the row's **What's booked on it**.
- [X] **M4 — the grid (ADR-0079 d.3)** — on `/schedule`, the two Eid columns are **shaded for every
  Baghdad row exactly like a weekend**, and collapse to narrow when every visible office is closed
  and nothing is booked. A resource in another office (if you have one) is NOT shaded.
- [X] **M5 — hired after (d.1)** — add a new person/resource to Baghdad **after** declaring Eid →
  their row shades for Eid too, with nothing else done.
- [X] **M6 — the spread steps over it** — book a person for "3 days" starting the day before Eid →
  the days land before and **after** the closure, never on it; the booking dialog's preview says so.
  Assign a campaign task whose span covers Eid → its daily bookings skip the closed days.
- [X] **M7 — leave no longer offers "holiday"** — **+ Record leave** → the Type list has **Leave**
  only. (An old holiday row, if any, still shows in the list and can be edited.)
- [X] **M8 — permissions** — as a maker (no `leave:manage`): both **+** buttons are absent, the
  closures table is visible, the stranded list opens read-only. Edit/Delete on a closure is
  two-step (arm, then confirm).
  (Automated run: no seeded role holds `leave:view` without `leave:manage` — a maker is refused at
  the route and has no nav entry, so the read-only rendering is unreachable from any seeded login;
  the two-step delete is checked as admin.)

## N — The single refined concept (ADR-0065 addendum, I48.15) [new]

Needs `supabase functions serve` restarted with the env file, so `propose-concepts` has the OpenAI key.

- [X] **N1 — propose** — on an approved campaign, open a department tab with a written brief. The
  panel is headed **"Proposed concept"** with **Propose a concept**. Press it → a blocking
  "Proposing a concept…" modal, then ONE concept: **Strategic thinking / Creative direction /
  Pillars** — and **no "Suggested content types"** section anywhere. The header says "Proposed by
  <you> · <time>".
- [X] **N2 — keep** — each item has **Keep** and **Delete**. Press Keep on one → it gets a green
  **Kept** tag and Keep disappears (Delete remains).
- [X] **N3 — delete opens a slot** — Delete two pillars and one direction → they vanish, the header
  says **"3 items removed, waiting to be regenerated"**, and the button reads **Regenerate removed
  (3)**. Before any deletion the button read "Regenerate removed (0)" and was disabled with a
  tooltip explaining why.
- [X] **N4 — regenerate fills only the gaps** — press it → "Regenerating the removed items…", then
  exactly **2 new pillars and 1 new direction** appear; every kept/untouched item is **exactly as
  it was** (same text, same Kept tag); the counter clears; the header gains "regenerated once, by
  <you> · <time>". Do it again after another deletion → "regenerated 2 times, last by…".
- [X] **N5 — one concept per brief** — there is no "Show proposed sets", no Latest/Earlier list.
  Reload: the same single concept, with the same kept marks.
- [X] **N6 — discard** — **Discard concept** is two-step ("Discard it — sure?"); after it the panel
  returns to "No concept proposed yet" and Propose a concept.
- [X] **N7 — a reader** — as a maker (no `projects:manage`): the concept is visible, with **no**
  Keep/Delete/Regenerate/Discard.
- [X] **N8 — the empty brief** — on a department whose brief is blank, Propose says "This brief has
  nothing written in it yet…" (a state, not an error dialog).
  (Automated run: it read "The concept could not be proposed right now" — the refusal code never
  reached the screen; fixed, I48.28.)

---

## Not implemented yet — skip for now

- **Default landing pages per role** — deferred by Edward (13 Sep) until the UI/UX work; leads still
  land on `/team`, AM/Traffic on `/schedule`, members on `/my-work`.
- **Per-department review buffers** — one tenant-wide number for now (M1); a department override is
  not built.

Tracker: `docs/TASKS.md` (I41, I44–I48). Decisions: ADR-0075 d.5/d.9, ADR-0078, ADR-0079, ADR-0065
addendum, ADR-0082…0092, with the 12 Sep amendments to ADR-0083/0090 (ownership, task-list approval)
and ADR-0091/0092 (close-out, processing + reporting).
