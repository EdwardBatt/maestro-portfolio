# ADR-0082: There is one way in

- **Status:** accepted (Edward, 11 Sep)
- **Date:** 2026-09-10
- **Open Decision:** none — from the Figma `▶ CS Flows` redesign, Edward, 10 Sep
- **Task(s):** I44

## Context

**Work enters Maestro by two unrelated doors today, and neither knows about the other.** A campaign
is created from `/campaigns` → New, which opens the five-step brief wizard. Ad-hoc work is created on
`/schedule`, where the booking dialog makes a deliverable under a per-tenant internal job with no
campaign (ADR-0035). They produce different shapes, are reached from different screens, and nothing
tells a person which one they wanted. **131 of this tenant's deliverables came through the second
door**, so it is not the minor path — for this agency it is the main one.

**The redesign makes one door.** Edward, 10 Sep: *"there is only one way… through the modal"*, opened
from anywhere by a shortcut and by the New button on `/campaigns`. Behind it, two choices: a single
job, or a full campaign. **This ADR is the door only** — the single-job flow behind it is being
specified one screen at a time at Edward's request, and the campaign builder is not being rebuilt at
all.

**The shortcut had to change twice, and the reasons are worth recording** because the constraint is
not obvious and will be re-proposed otherwise. Edward's original brief asked for a shortcut that
avoids what people already know, ruling out `Ctrl+N` — *"almost universally a new file"*. The Figma
answered with a bare `N`. Then `Ctrl/Cmd+N` was asked for anyway, and **it cannot be built**: browsers
reserve the accelerators that manage their own windows and tabs — `Ctrl+N`, `Ctrl+T`, `Ctrl+W`,
`Ctrl+Shift+N` — and act on them before the page is told anything, so there is no event to cancel.
That is a safety property (a page that could swallow `Ctrl+W` could trap you in a window) and no
browser offers a way round it. Only an installed desktop app can claim those keys, which would make
the shortcut depend on how each person happened to open Maestro.

**Bare `N` was then rejected on use, not on mechanism.** Edward: *"it is going to frustrate users as
they have to make sure they are not in an editable field… too easy to make a mistake."* Correct, and
it is the standing objection to every unmodified letter shortcut: correctness depends on where focus
happens to be, and the failure is silent — a stray `N` in a brief, or a modal over half-typed work.

## Decision

1. **One door.** The new-request modal is the only way work is created. Everything else either opens
   it or is retired.

2. **`Ctrl/Cmd + P` opens it, from anywhere in the application.** `Escape` closes it. It is delivered
   to the page and can be claimed, unlike `Ctrl+N`.

3. **The cost is stated rather than discovered: this takes Print.** Maestro has no print feature of
   its own — no print stylesheet, nothing calls `window.print`, and the word does not appear in the
   copy — so nothing internal breaks. What goes is the BROWSER's `Ctrl+P → Save as PDF`, which on
   most screens is the only way to get a brief or a schedule into a file. **Accepted knowingly**
   (Edward, 10 Sep, after the trade was put to him). If it bites, the answer is an explicit export on
   the screens that need one, not a different shortcut — moving the shortcut later would be worse
   than never having had it.

4. **`projects:manage` gates the whole modal**, so it is not offered to somebody who cannot proceed.
   Absence, not a disabled control (design doc §2.3, and the rule `nav-config` already follows).

5. **Two choices behind the door: a single job, or a full campaign.** "Took it on a call" is
   **removed** — Edward: *"we cannot draft a confirmation message based on nothing."* The verbal
   brief instead asks the client for a written confirmation, and the reply becomes the evidence at
   step 2. That is a decision for ADR-0084, not this one, but the door must not offer a third choice
   that no longer exists.

6. **"Full campaign" opens the EXISTING five-step wizard, unchanged** — Job Type · Strategy ·
   Deliverables · Timing · Review & Approve. The Figma shows a four-step builder and its badge says
   FOUR STEPS; **that is not a specification** and no step count is written into this decision.
   Merging steps is open and belongs to its own piece of work.

7. **`/campaigns` → New opens this modal** rather than going straight to the wizard, so the choice
   between a job and a campaign is made in one place regardless of where somebody started.

8. **Ad-hoc creation from `/schedule` is retired.** The `+` there selects from existing projects, and
   **a single job behaves as a project** — Edward, 10 Sep. This is the consequential half of the
   decision: it means new work has ONE shape, and the ad-hoc model stops being a second one. It also
   makes the single-job flow's own growth natural rather than special — a job that gains a second
   deliverable is an ordinary project, not an exception (which is what ADR-0083 has to settle).

9. **Existing ad-hoc work is untouched.** The 131 deliverables already on that model live out their
   lives on it; nothing new joins them, and no migration rewrites them. Written as an assumption,
   put to Edward in the synopsis he accepted on 11 Sep, and taken as confirmed by that acceptance:
   the old path is hidden, not deleted.

10. **The clock starts when the client asked, not when the form was opened** (Figma SJ-01: *"the clock
    starts at the moment the client asked — not now"*). Stated here because it is a property of every
    route through the door; how it is captured and what it measures belongs to ADR-0084.

## Consequences

**Easier.** "Where do I create this?" has one answer. A person who starts in the wrong place is
carried to the right one rather than producing the wrong shape of record, which is what the two
unrelated doors have been doing — and it is why the ad-hoc pile is 131 deliverables rather than the
exceptions the model was designed for. The choice between a job and a campaign is made once, visibly,
with the difference explained on the screen where it is made.

**Harder.** A shortcut that takes a universally known one is a decision that cannot be quietly
reversed: people will learn it, and moving it later costs more than choosing it well now. Retiring
the schedule's ad-hoc path removes the fastest route the pilot has — assigning work in two clicks
from the grid — and replaces it with a modal, so the new door has to be genuinely quick or it will be
resented by exactly the people who use the old one most. And gating on `projects:manage` means the
people who currently create ad-hoc work must actually hold it; **that is worth measuring before this
ships**, because if they do not, the door closes on them.

**Locked in.** That there is one intake, and any future way of creating work is a route INTO this
modal rather than beside it. That a single job and a campaign are the same kind of thing at different
sizes — which is what makes promotion possible at all, and what ADR-0083 builds on. And that the
answer to a shortcut collision is to change what the application offers, never to reach for a key the
browser has reserved.

## Addendum — 11 Sep, from the independent review

**The shortcut is claimed from inside a field too.** The first build left `Ctrl/Cmd+P` to any
editable element (input, select, textarea, contenteditable), so that a modal would not land over
half-written work. The review found the cost: with focus in a field or a `<select>` — where it sits
after most picks on SJ-02 — the door did not claim the key and the BROWSER's Print opened. That is
the focus-dependence d.2 was chosen to remove. `Ctrl+P` types nothing, the door is a modal Escape
closes with the work still underneath, and d.3 took Print knowingly; so the press is claimed
everywhere. `isEditableTarget` is gone.

## Addendum — 12 Sep, the design pass and four decisions

**The intake screens are rebuilt to the Figma CS-Flows frames.** The first build used the design
tokens but laid the screens out ad-hoc, so they did not match the frames — Edward's clarification:
*"the site as the source of truth is the data and fields, not the visual; the Figma is the visual
aspect, the design system is already updated."* So the FIELDS stay what the data model holds (the
brand modal keeps its one name field — there is no short-name column — even though the frame draws
two), and the VISUAL follows the frame. A reusable component layer now carries all seven surfaces —
`Modal`/`ModalHeader`/`ModalFooter`, `Tag`, `Field`, `Panel`, `StepRail`, `PillSelect`,
`ChoiceCard`, plus `PromoteDialog` — built from the repo's `.pen` tokens, responsive, RTL-checked.
The door, SJ-02, SJ-03, SJ-04, and the A1/A2/A3 modals were each screenshot against their frame.

**Four decisions, all Edward's (12 Sep):**

1. **Ad-hoc creation on `/schedule` is NOT retired yet.** d.8 said it goes "once this system is
   implemented"; Edward: *"once it is thoroughly tested, merged, and in use on production for at
   least a week — and it is my decision to switch off."* The first build removed it early. Restoring
   it is entangled with the ADR-0087 booking-request work built on top of the removal, so it is
   tracked as its own change (`I44.14`) rather than rushed into this delivery — the removal was
   premature, and putting it back needs its own test pass.

2. **`Ctrl/Cmd+P` is claimed for everyone**, revising d.4. Someone without `projects:manage` gets a
   one-line message — new work comes through their account manager, internal work needs permission —
   instead of the browser's Print opening on top of the app. Print is taken from the key in both
   cases (d.3), so behaviour no longer depends on who presses it.

3. **The campaigns list is read-only for everyone.** Edward: *"All users should be able to access
   the /campaigns page."* A new `projects:view` grant, held by every non-portal role
   (`20260912100000`, test 108), opens the read; `projects:manage` still gates New, Promote, Discard
   and everything the wizard writes. The list read was already allowed by RLS.

4. **The "+ New internal project" door is removed**, and internal work comes through the same door
   with the agency as the client. The `/campaigns/internal` create route and its link are gone;
   existing internal projects stay viewable as the jobs they are, on the normal lists.

**Functional fixes found in Edward's first test run:** the environment banner now shows on the
login page too (you should know which database you are signing into before you sign in); the New
button shows its shortcut keycap; the brand dialog's `clients.saveFailed` (a missing key that
rendered raw) is fixed; and a brand registration that "failed" was a stale login after a
`db reset` — role ids regenerate, so an old JWT carries a dead role and every write 403s
(traps.md). Re-signing in fixes it.

## Addendum — 13 Sep, d.8 reversed for now: ad-hoc creation returns to `/schedule`

d.8 retired ad-hoc creation from the booking dialog (new work enters through the one door). Testing,
Edward found it had been switched off prematurely: *"I did not ask this to be disabled yet … you did
not reactivate ad-hoc as requested."* His decision 1 (ADR-0082 addendum, 12 Sep) already said ad-hoc
comes off **only** after the redesign is thoroughly tested, merged, and in production ≥1 week, at his
call — so until then ad-hoc creation stays.

**Done (I48.5):** the booking dialog offers a **Project task / Ad-hoc task** toggle on a person again;
ad-hoc creates a reviewable deliverable through `create_adhoc_deliverable` (name + a single reviewer,
hours, dates, optional requirements), exactly as before d.8. Ad-hoc is offered only when the person
is in **direct** reach — an out-of-reach person has no ad-hoc request path, so it stays project work
that becomes a request (ADR-0087). `BookingDialog`; tests in `BookingDialog.test.tsx`. This closes
the deferral recorded as `I44.14`. d.8 will be re-applied when Edward switches ad-hoc off per his
decision 1.
