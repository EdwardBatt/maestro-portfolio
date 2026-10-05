# CLAUDE.md — Maestro

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `AGENTS.md` first. It is the canonical ruleset and it is binding** — boundaries,
structure, naming, coding principles, security bar, testing bar, decision discipline. This file
adds only the working agreements and commands that `AGENTS.md` does not cover; it never restates or
overrides it.

**Then read `docs/memory/README.md`.** That is the shared project memory — the same store Cursor,
Gemini, Antigravity and Cowork read and write. It routes you to the context for your task; this file
deliberately does **not** carry a project summary. See `AGENTS.md` §9 for the protocol, or run
`/memory-start <what you are working on>`.

Claude-specific working agreements:

- **Git belongs to Edward.** Never commit, push, or run migrations unless explicitly asked in
  the current session. Prepare files, report what changed and which tracker IDs they map to.
- **Tracker discipline:** work maps to task IDs in `docs/TASKS.md`; reference them in all
  proposed commit messages (`feat: … [M1.6]`) and tick checkboxes in the same change set.
- **Decisions:** if a task is ⚠️-gated by an Open Decision, draft the ADR (skill:
  `maestro-adr`) and stop for approval before implementing.
- **Skills:** use the project skills in `.claude/skills/` — `maestro-migration`,
  `maestro-rls-testing`, `maestro-edge-function`, `maestro-feature`, `maestro-adr`,
  `maestro-e2e` (browser testing, adapted from Anthropic's webapp-testing),
  `maestro-design` (design language, adapted from Anthropic's frontend-design) — whenever
  their domain comes up. They encode the repo's required patterns; don't re-derive from
  scratch. `skill-creator` (vendored, Apache-2.0) maintains the set. See
  `.claude/skills/README.md`.
- **Commands:** `/memory-start` loads the right context for a task; `/memory-close` writes what the
  session learned back into `docs/memory/`.
- **When uncertain**, the authority order is: current code → accepted ADRs → `AGENTS.md` → design
  doc v15 → `docs/TASKS.md` → `docs/memory/` → ask Edward. Never guess on security, licensing, or
  money.

## Commands

```bash
npm run dev            # Vite dev server
npm run build          # tsc -b (typecheck all projects) then vite build
npm run typecheck      # tsc -b only — run after every schema/type change
npm run lint           # oxlint
npm test               # vitest run (unit: capacity math, tz, Zod, engines)
npm run test:watch     # vitest watch
npm run format         # prettier --write .
npm run e2e            # playwright test (per-role surfaces, portal scoping, RTL)
npm run check:licenses # license allowlist gate (permissive-only, ADR-0002/0003)
npm run check:authz    # ADR-0037 — no Edge Function reads a grant table
npm run check:e2e-coverage   # I49 — every control has a browser test; fails on a gap not in e2e/coverage-baseline.json
node scripts/memory-lint.mjs   # health-check docs/memory/ (dead links, stale notes, over-long capsules)
```

Run a **single unit test**: `npx vitest run src/lib/capacity/engine.test.ts` (or `-t "name"` to
filter by test name). Tests are colocated (`*.test.ts[x]` next to source); jsdom + Testing Library,
setup in `src/test/setup.ts`.

**Database (remote-only — no local Supabase, no Docker; see README "Getting started"):**

```bash
bash scripts/db/verify.sh                          # migrations + pgTAP against a throwaway Postgres (also CI)
supabase db push                                   # apply supabase/migrations/ to the linked hosted project
supabase gen types typescript --linked | Out-File -Encoding utf8 src/types/database.ts
npm run typecheck                                  # verify against regenerated types
```

`src/types/database.ts` is **generated** — never hand-edit it (`AGENTS.md` §1). It lags one migration
behind until `gen types` re-runs; that gap is bridged by `supabaseUntyped`. Applying migrations,
committing, and pushing are **Edward's** actions — prepare the files and stop. CI runs the database
job on every pull request, so open a PR rather than merging to get it verified.

## Where the project context lives

Not here. `CLAUDE.md` is a router, and keeping it one is what stops it drifting into a stale project
summary.

| You need | Go to |
|---|---|
| the rules | `AGENTS.md` |
| what to read for this task | `docs/memory/MAP.md` |
| what is actually built | `docs/memory/STATE.md` |
| why something broke before | `docs/memory/traps.md` |
| a decision and its reasoning | `docs/adr/` — the index is `docs/adr/README.md` |
| what is planned | `docs/TASKS.md` |
| how to deploy or operate | `docs/RUNBOOK.md` |

When an ADR and an older document conflict, the ADR wins. When the code and any document conflict,
the code wins — and fix the document in the same session.
