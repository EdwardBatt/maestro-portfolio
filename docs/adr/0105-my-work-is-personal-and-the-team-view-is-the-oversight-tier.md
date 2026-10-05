# ADR-0105: My Work is personal, the Team page is the oversight tier, and everything that needs action is in "Needs you"

- **Status:** accepted (Edward, 25 Sep — on `running-it`)
- **Date:** 2026-09-25
- **Open Decision:** none
- **Task(s):** `I59.10`, `I59.12`, `I59.13`, `I59.14`, `I59.15`
- **Amends:** ADR-0018 (dashboards are grant-driven three-tier surfaces) — builds its tier 2 on the Team page

## Context

The v3 Figma sections E (team lead), F (team member) and G (Needs you) put a lead's queue and team
pages under **My work** ("My work · Creative queue", "My work · Creative team") and label the
"Needs you" pages "Dashboard" while the menu highlights My work. Edward, 25 Sep: *"flows E, F and G are
confusing as they are mixing up my-work with a completely new view (team for team leads) the
associated view for a dept lead is missing… The my-work scope view is already established,
therefore what should apply from this is only the styling and the extra functionality offered by
the various panels."*

ADR-0018 (15 Aug) already drew this line: tier 1 is **My Work** (self, `my_tasks:view`), tier 2 an
**oversight** surface scoped team → department → account, tier 3 health. Tier 2 was never built;
the `exceptions:view` grant is seeded and unused. What exists is a read-only **Team page**
(`/team`, `team:view`) that already reads the team for a team lead and the department for a
department lead — the shell of tier 2.

Today My Work has eight panels (attendance, six counts, *Waiting for you*, *Awaiting your review*,
Today, Other, Completed, news) and its task rows open four pop-ups (Deliverable, Submit, Review
feedback, Ask for more time). Assigning happens on `/schedule`, whose booking dialog is the only
assignment door.

Options weighed for where the lead's views live: **(a)** My Work stays personal and Team becomes the
team / department view; **(b)** tabs on My Work (Mine · My team · My department). (b) makes My Work
differ by role and duplicates the Team item leads already hold. Edward chose (a).

## Decision

**d.1 — My Work is the same page for everyone and shows only my own work and what asks me to act.**
It keeps every panel it has today; the lists become *Today · This week · Later · Waiting on someone
else · Completed (folded)*; it gains *Your week* (booked hours per day) and *Before you start* (the
campaign's rules).

**d.2 — "Needs you" is one list of everything asking me to act** — approvals, reviews, answers,
assignments, the lead's team items — replacing *Waiting for you* and *Awaiting your review* (a review
card keeps everything that panel shows). It is grouped by the clock: **today or it slips** (escalates
within 8h, already escalated, or its task due today / overdue), **this week** (any other clock),
**quietly** (no clock); most urgent first. Unassigned work appears in the **deliverable owner's**
list only (ADR-0100: the owner approves the task list and assigns). A review appears only for the
reviewers named on the task (ADR-0043) — there is no "for your eyes" copy for the owner.

**d.3 — A task has its own page** (Figma M2 / M4): the brief, how the request came in, where it is,
the file or note for this round, the rules, the attachments, questions, and Start / Send for review /
Ask for more time / Ask someone / I'm blocked. Every function of the four row pop-ups moves onto it
and the pop-ups are removed.

**d.4 — The Team page is tier 2.** A team lead or deputy sees their team; a department lead sees the
department with people grouped under their team (and "No team"); a role without a team or department
of its own that holds `team:view` picks a department. Four tabs — **Timeline** (one bar per task,
coloured by its workstream, a Workstream filter), **By person**, **By piece**, **Load** (three weeks) —
under four live figures (people and % booked, at risk, unassigned, in review), with week arrows as
the Schedule has. The "soon" placeholders go.

**d.5 — Assigning and moving work happen on the Schedule and on the team timeline alike**, through the
same assignment and the same checks; both refresh every 20 seconds and on returning to the tab. A
move past the committed date warns (the L6 dialog) and offers **Move it anyway**, as every other
check does (ADR-0061: warn, never refuse). The booking dialog is restyled to the Figma's L2 and keeps
every field and behaviour.

**d.6 — The side menu keeps every item each role has today**, restyled. The Dashboard is untouched;
landing pages stay parked (`I48.16`).

## Consequences

Easier: one personal page for every role and one oversight page scoped by role, which is ADR-0018's
shape with no per-role screens; nothing a person can do today disappears. The Schedule gains the
refresh it never had.

Harder: two screens now write assignments and bookings, so every check must live in one shared place
(`drop-check`, the capacity engine) or they drift. "Needs you" becomes the reader of many sources
(pending approvals, reviews, extensions, change requests, inputs, escalations, questions); it must stay
one query per source, not a new table. The review panel's behaviour is re-hosted, and its browser
tests move with it.

Locked in: My Work is never role-specific; oversight lives on Team; a person's own exceptions are tier
1 (ADR-0018 d.3 kept). `exceptions:view` stays seeded and unused — the Team page gates on `team:view`
as it does today.
