---
name: maestro-e2e
description: Browser testing for Maestro — committed Playwright suites (role-surface walkthroughs, portal scoping probes, RTL smoke) plus an exploratory toolkit for debugging the running app. Use for any browser-level testing or UI debugging. Adapted from anthropics/skills webapp-testing (Apache-2.0; upstream license retained in this folder).
---

# Maestro browser testing

Two distinct modes — don't mix them up:

1. **Committed suites** (`e2e/`, TypeScript Playwright) — the merge gate. Role walkthroughs,
   portal probes, RTL smoke. These are versioned, deterministic, `data-testid`-driven.
2. **Exploratory probes** (throwaway Python scripts using `scripts/with_server.py`) — for
   debugging the running app, reconnaissance, screenshots, console logs. Never committed.

## Running the Maestro stack for testing

Local stack = Vite dev server (port 5173) + Supabase local (`supabase start`, API on 54321).
For exploratory work, let the helper manage the dev server lifecycle (run `--help` first;
treat helper scripts as black boxes — don't read their source into context):

```bash
python .claude/skills/maestro-e2e/scripts/with_server.py \
  --server "npm run dev" --port 5173 -- python probe.py
```

Supabase local is stateful — start it once (`npx supabase start`), don't wrap it in the
helper. Seed with the fixture script before suites run. **Never point any test at a remote
or production Supabase.**

Exploratory probe pattern (reconnaissance-then-action): navigate → `wait_for_load_state('networkidle')`
(critical for a Vite SPA — the DOM is empty before JS runs) → screenshot / inspect DOM →
then act with discovered selectors. `examples/` has patterns for element discovery and
console-log capture.

## The three committed suite families

**1. Role-surface walkthroughs** — the design doc's §2.3 surface lines are literally the
test scripts. One spec per role (creative, booker, team lead, support, admin): log in as a
seeded user of that role, walk their whole job.

- Everything the surface line promises is reachable and works.
- **Leakage assertions:** controls belonging to other roles are asserted absent —
  `expect(locator).toHaveCount(0)` on foreign-role testids (a creative's spec proves
  capacity ceilings, billing, and others' SLA data are not in the DOM).
- Booker spec covers warn-and-allow end-to-end: clean booking passes silently; over-ceiling
  shows exactly one warning with a working "proceed".

**2. Portal scoping probes** — browser-level twin of `maestro-rls-testing` (pgTAP proves the
DB denies; this proves the UI/API layers don't leak through other channels):

- As client C1's portal user: only C1's work visible; assert absence of rates, capacity,
  internal threads, other clients — **including in network responses**
  (`page.on('response')` sniffing JSON payloads for excluded fields, not just the DOM).
- Direct navigation to a C2 deliverable URL and a C2 media URL → denied, empty body.
- Approve a milestone → audit record visible, immutable.

**3. RTL + i18n smoke** — every role walkthrough re-runs with locale `ar`: layout mirrors
(screenshot diff on key screens), no raw-key leak text (assert nothing matching
`/^[a-z0-9_.]+$/` renders), dates/numbers localized.

## Conventions (committed suites)

- Selectors: `data-testid` only — never text (bilingual app) or CSS structure.
- Auth: one seeded storage-state per role under `e2e/.auth/` (gitignored), created by a
  setup project; specs never contain credentials.
- Specs independent and re-runnable; state via API/seed helpers, never via UI chains from
  other specs.
- Scheduler drag interactions: `page.mouse` sequences with explicit waits on the drop
  result (booking chip rendered) — no fixed timeouts.
- Debugging failures: reproduce headed with `--debug`, capture trace
  (`--trace on-first-retry`), read the trace before editing the test; screenshot the
  failure state.
- CI: chromium project is the merge gate.
