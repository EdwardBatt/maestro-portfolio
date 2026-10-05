---
type: map
status: current
origin: ai-derived
verified: 2026-09-08
sources: [src/, <other roots>]
---

# Map — what to read for the task in front of you

Find the row that matches your task. Read that capsule. Then read the source files it names. Do not
read the other capsules.

Each row carries its capsule's **abstract** — one sentence saying what that capsule is for, copied
verbatim from the capsule's own front matter and held identical by `scripts/compass-lint.mjs`.
Decide from the abstract whether the capsule is the right one; that is what it is for, and it means
you never open a capsule to find out it was not.

**The left column is the words somebody would actually say**, not module names. If two rows match one
spoken task, the rows are wrong. If none does, that is the most useful thing this file can tell you.

| Your task touches… | Capsule | Source to open | Decisions that bind it |
|---|---|---|---|
| <"why was I refused?", roles, permissions> | [authorization](capsules/EXAMPLE.md) — Who may do what, and to which rows — the most expensive thing on this project to re-derive, and the easiest to get subtly wrong. | `src/...`, `...` | <ADR numbers> |
| <the densest domain in your project> | | | |

## Not covered by a capsule

No capsule exists yet for these. Go straight to the source; write a capsule only if a session shows
one is genuinely needed.

| Area | Source | Decisions |
|---|---|---|
| <area> | `path/` | <ADR numbers> |

## The shape of the codebase

- `<dir>/` — <one line: what lives here and the one file that matters most>
- `<dir>/` — <…>

## Where the answer is not in memory

- **What the rules are** → <your agent instructions file>
- **Why a decision was made** → the ADR. They carry reasoning, not just outcome
- **What is planned** → <your tracker>
- **How to deploy or operate** → <your runbook>
