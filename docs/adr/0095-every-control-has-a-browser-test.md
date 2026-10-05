# ADR-0095: Every control has a browser test, as one who may and one who may not

- **Status:** accepted (Edward, 2026-09-21 — *"lets resolve 4, 5 and 6"*; recorded 22 Sep)
- **Date:** 2026-09-17
- **Open Decision:** none — a change to the testing bar (`AGENTS.md` §7), which the ADR skill says
  needs an ADR
- **Task(s):** I49.0; the rule the whole of I49 was built to
- **Depends on:** [ADR-0081](0081-unreleased-work-runs-locally.md) (the suite runs against the
  seeded local stack, never production), [ADR-0092](0092-work-in-progress-is-shown-and-failures-are-reportable.md)
  (a failure is worded and reportable — which is what a refusal must NOT be), [ADR-0037](0037-one-authorization-primitive-one-call-path.md)
  (authority is decided once, in the database — so "may not" is a real answer, not a hidden button).
  Relates to ADR-0041 (reach is chosen, so there is always someone outside it).

## Context

On 15 Sep a user pressed **Add sub-task** on a deliverable and it failed (`I48.42`). No test had
ever pressed it. Edward: *"the Playwright tests were completely inadequate."*

They were inadequate in a specific way. `AGENTS.md` §7 asked for *"per-role surface walkthroughs
… portal scoping probes; RTL smoke pass"*, and that is what existed: the retest plan (sections A–N)
listed what each screen **shows** and walked **one chosen path** per flow, as the person most likely
to succeed. A walkthrough proves the happy path for the happy person. It says nothing about the
other buttons on the screen, and nothing about the person the button should refuse.

The count made it concrete: **621 interactive controls** across 64 screens, a third of them pressed
by any test. By the end of 15 Sep every reachable one was (`I49.2`–`I49.65`), twenty defects came
out of pressing them (`I49.66`–`I49.85`), and a gate now runs in CI: `scripts/check-e2e-coverage.mjs`
lists every `data-testid` on an interactive element in `src/` against every id a spec under `e2e/`
presses, and fails on any control not named in `e2e/coverage-baseline.json` (the backlog, each entry
with its reason). The practice has run for two days. What is missing is the sentence that makes it
the rule rather than a script somebody could delete.

### What was weighed

- **Leave §7 as it is and rely on the gate.** Rejected. The gate enforces *pressed by some test*;
  it cannot enforce *by whom* or *what a refusal looks like*, and those two are where the 15 Sep
  defects actually lived (a control that worked for the admin and failed for the owner; a failure
  that said "Something went wrong"). A script is not a rule; the rule has to say what the test is
  for.
- **Require a test per role per control.** Rejected. Every role × 621 controls is not a suite
  anyone runs, and most of the matrix is the same answer. Two people — one the control is for and
  one it is not — is the smallest pair that proves the authority is real.
- **Count coverage by lines, the unit-test way.** Rejected. Line coverage of a React component says
  the code rendered, not that a person could reach and press it; the three unrouted pages
  (`I49.79`) have unit tests and no user.

## Decision

1. **Every interactive control in `src/` has a browser test that presses it.** Interactive means
   a button, input, select, textarea, anchor or form, the `Button` family, or any element with an
   `onClick` / `onChange` / `onSubmit`. It is identified by its `data-testid`, which every
   interactive control carries. Display-only ids (a row, a label, a status) are counted, not
   required.
2. **The test presses it as two people: one who may, and one who may not.** The "may" is a seeded
   person the control is for, and the test asserts what the control does. The "may not" is a seeded
   person outside its authority — another department, another role, no grant — and the test asserts
   the refusal. Where nobody can be refused (a status bar, a filter), the "may not" is the state in
   which the control does nothing, and the test asserts that it does nothing.
3. **A refusal is worded and never reportable.** The person is told, in a sentence, why not
   (ADR-0092's `classifyWriteFailure` for a database refusal); the dialog does not offer *Report to
   your administrator*, because a refusal is not a failure. A test that sees a raw error, a generic
   message or a Report button on a refusal fails.
4. **The gate is `npm run check:e2e-coverage`, in CI on every pull request.** It fails on any
   control not pressed by a spec and not in `e2e/coverage-baseline.json`. The baseline is a named
   backlog: every entry carries a reason and a task id, and a control leaves it when its test lands
   (`--write-baseline` after the spec, never before). A control nobody can reach is not covered; it
   is a defect (`I49.79`), and stays in the baseline under that id until routed or deleted.
5. **The suite runs against the seeded local stack** (ADR-0081), and its people are the twenty in
   `e2e/local/fixtures.ts`. A test that needs a person the seed does not have adds the person to the
   seed, not to production.
6. **`AGENTS.md` §7 gains one line** stating 1–3 and naming the gate. This ADR is the reasoning; the
   line is the rule.

## Consequences

- **Easier:** a control that fails for a real user and was never pressed by a test cannot happen
  silently again — the pull request that adds the control fails CI until a test presses it. The
  "may not" half means authority changes (a grant moved, a policy widened) surface as test changes,
  which is where a reviewer sees them.
- **Harder:** every new control costs a spec, as two people. The coverage suite is already a dozen files
  under `e2e/local/coverage/`; it runs in one worker against a shared database (traps.md) and grows with the
  product. Specs must press concrete ids — a helper over a prefix variable (`*-save`) is invisible
  to the gate (`I49.1`) — which constrains how specs are written.
- **Locked in:** `data-testid` on every interactive element is now a contract, not a convenience.
  Renaming one is a change to the suite. The baseline is the only permitted exception, and it is
  reviewed, not edited.
