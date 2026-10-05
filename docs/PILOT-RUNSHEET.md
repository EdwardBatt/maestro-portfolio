# Pilot Run Sheet — inviting real users (Phase L5)

*Practical checklist to go from "deployed" (L4 ✅) to "real testers using it." Follow top to bottom. Items marked **[you]** are yours (data/decisions); **[done]** is already built.*

---

## 0. Before you invite anyone (30–45 min)

1. **[you] Load real data in the order below** (§1) — testers need real offices/people/resources to book against. This is the one true blocker.
2. **[you] 5-minute smoke click-through** (§2) — prove the core loop works on prod with real data before anyone else logs in.
3. **[you] 2-minute Arabic/RTL glance** (§3) — flip the language toggle, eyeball a few screens.

Once those three pass, you're clear to invite (§4).

---

## 1. Load real data — dependency order [you]

Enter via the admin UI. **Order matters** — later items reference earlier ones. (Clients/campaigns are optional: Module 1 runs ad‑hoc, so you can skip them and book with free‑text task names.)

1. **Offices** (Admin → Organization → Offices): name, timezone, **working week**. *Do this first — the grid shades non‑working days from the office, and people/resources attach to offices.*
2. **Departments** (Admin → Organization): e.g. Creative, Production, Client Services.
3. **Teams** (Admin → Organization): under their departments (e.g. Creative → Art & Video). *Needed for team‑lead scope.*
4. **Equipment / rooms** (Admin → Resources → New): cameras, edit suites, meeting rooms — the non‑human bookable resources. Set their **office + department/team**.
5. **Invite staff** (Admin → Users → Invite): each person's email + role + office + department + **team**. *Inviting a person auto‑creates their bookable human resource (ADR‑0011), and — now that update‑user syncs — their office/department/team flow onto that resource.*
6. **Verify resource wiring** (Admin → Resources): confirm each human has the right **office** (for working‑day shading) and **team/department** (for who can book them). Fix any that are blank.
7. *(Optional, later)* Clients/campaigns — skip for the ad‑hoc pilot.

**Sanity check after loading:** open the Schedule grid — you should see your real people, grouped correctly, with non‑working days shaded red. If shading is missing, the resource has no office (see step 6).

---

## 2. 5‑minute manual smoke test (prod, before inviting) [you]

Log in as a Power Admin and walk the core loop:

- [ ] Sign in (email + password).
- [ ] Schedule grid loads; real resources visible; non‑working days shaded.
- [ ] Create an **ad‑hoc booking** (pick a person, free‑text task, dates, hours) → it appears on the grid.
- [ ] Try a booking that overloads someone → the **warn‑and‑proceed** prompt appears; proceed works.
- [ ] **Move** a booking to another day (drag) → it moves.
- [ ] **Cancel** the booking → it disappears.
- [ ] Open **Admin → Users, Resources, Organization** → all load.
- [ ] Switch language to **Arabic** → layout mirrors (§3); switch back.
- [ ] Sign out.

If all pass, the deployed system is healthy. *(The automated version of this is the Playwright smoke suite — `L5.1`, delivered separately — which runs this in CI so a future broken deploy is caught before users see it.)*

---

## 3. Arabic / RTL visual check (2 min) [you]

Code is RTL‑correct by construction (logical properties throughout, layout mirrors on `dir="rtl"`). This is just a confidence glance in the browser with Arabic on:

- [ ] Sidebar/nav mirrors to the right; icons and text read naturally.
- [ ] A dialog (e.g. New booking) — labels/fields mirror, buttons on the correct side.
- [ ] The grid — resource column on the right, dates flow right‑to‑left.
- [ ] Codes/emails/timestamps stay left‑to‑right (intentional).

Report anything that looks wrong and I'll fix it — but the foundation is sound, so expect this to pass.

---

## 4. Invite testers [you]

1. Admin → Users → **Invite** each tester (role + office + department + team).
2. They receive an **email with a code** (not a link — ADR‑0012). Tell them: open the link in the email, the email is **pre‑filled**, enter the **code** + set a password. If the code expired, the **"Resend code"** button emails a fresh one.
3. First login lands them on their **role‑aware home** (Power Admin → Overview; scheduler → Schedule; creative → My work).

**One‑line note to send testers:** *"You'll get an email with a 6–8 digit code. Click the link, the code screen opens with your email filled in — type the code and set a password. If it's expired, hit Resend code. Then you're in."*

---

## 5. Phased pilot rollout [you]

- **Day 1–2:** bookers + team/department leads only — they create/manage bookings, exercise scope.
- **Day 3+:** creatives / team members join (mostly read‑only — My work, My calendar).
- Keep the group small first; widen once it's stable.

---

## 6. Feedback loop

- Testers use the in‑app **Feedback** button (already built) — it lands in Admin → Feedback.
- Triage daily into `docs/TASKS.md` (or issues). Bugs → fix; requests → park with a task ID.

---

## 7. Go / no‑go checklist [you]

Green‑light the pilot only when:

- [ ] Real data loaded and resource wiring verified (§1).
- [ ] Manual smoke passed on prod (§2).
- [ ] Arabic glance passed (§3).
- [ ] Backups/PITR confirmed on the prod tier (L4.5) and `docs/RUNBOOK.md` has the rollback steps.
- [ ] You can name the rollback move if something breaks (revert Vercel deploy; DB restore from PITR — see RUNBOOK).
- [ ] A named owner watches feedback daily during the pilot.

If any box is unchecked, hold the widening — but a **small** invite (a few trusted colleagues) is fine to start gathering signal.

---

## 8. What's still open (not blockers to a small pilot)

- **`L5.1`** automated Playwright smoke (durable safety net for future deploys) — delivered; wire a test account + CI secret when convenient.
- **`L5.4`** perf check at real pool size — do once real data is in and you see the grid at full size; flag if anything drags and I'll add pagination/virtualization.
- **Deploy reminder:** Edge Function changes (`update-user`, `booking-transition`) and email‑template edits don't ship via git — redeploy/re‑paste after each relevant push.
