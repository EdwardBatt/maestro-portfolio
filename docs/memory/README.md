---
type: map
status: current
origin: human
verified: 2026-08-26
sources: [AGENTS.md, docs/adr/, docs/TASKS.md]
---

# Project memory — start here

Shared, agent-independent memory for Maestro. One store, read and written by every AI tool that
works on this repository. Plain Markdown in git: no plugins, no database, no sync step.

**Maestro** is a multi-tenant work-management app for a creative agency — scheduling people and
equipment against capacity, running client campaigns through a brief → deliverable → task → review →
sign-off lifecycle, with per-tenant isolation enforced by Postgres RLS. React + Vite front, Supabase
/ Postgres behind, Deno Edge Functions between. Alpha, in live pilot with real users.

## Read in this order. Stop as soon as you have enough.

| Tier | Read | When |
|---|---|---|
| 0 | this file | every session |
| 1 | [MAP.md](MAP.md) | every session — it routes you to the rest |
| 1 | [STATE.md](STATE.md) | when the task depends on what is already built |
| 1 | [traps.md](traps.md) | before debugging anything that "should work" |
| 2 | one capsule from [capsules/](capsules/) | the map names it |
| 3 | the actual source files | always, last, and they win |

Do **not** read the whole vault. Do not read a capsule the map did not name for your task.

## What wins when sources disagree

1. **Current source code, migrations, live schema, running config.** Always.
2. **Accepted ADRs** in [../adr/](../adr/) — Edward's decisions.
3. **[AGENTS.md](../../AGENTS.md)** — the binding rules.
4. **[TASKS.md](../TASKS.md)** — what is built and what is planned.
5. **This directory** — orientation, dated, assumed stale until checked.
6. **sessions/** — most recent, least authoritative.

Code beats documentation. An explicit human decision beats AI inference. A current decision beats a
historical one. A session note never overrides a capsule by itself — it triggers a check, and the
capsule is corrected if the code agrees.

**If a note contradicts the code: the code is right. Fix the note in the same session, and say so.**
Never leave both readings standing.

## What belongs here — and what does not

Memory holds **orientation** (where to look), **state** (what is built), and **traps** (expensive
lessons). That is all.

It does **not** hold:

- **Decisions.** Those are ADRs. Two homes for one decision guarantees a contradiction.
- **The rules.** Those are `AGENTS.md`.
- **The schema.** That is `supabase/migrations/` and the generated types.
- **Source code.** Capsules point at files; they never paste them.
- Anything one grep would answer.

## Writing to memory

Update the existing note. A new file needs a reason. Then set `verified:` to today.

- A discovery that cost real time → [traps.md](traps.md).
- Something built, or found already built → [STATE.md](STATE.md).
- Orientation that will be true next month → the capsule.
- A decision → an ADR (skill `maestro-adr`), never here.
- Session notes: **only when Edward asks**, or when a session leaves something genuinely unfinished
  that the next one needs. See [sessions/README.md](sessions/README.md).

Frontmatter on every note:

```yaml
type: capsule | state | trap | session | map
abstract: <one sentence>        # CAPSULES ONLY, and mandatory there — see below
status: current | needs-check | superseded
origin: human | ai-derived      # human = Edward said it, or it is an accepted ADR
verified: YYYY-MM-DD            # last date this was checked against the actual code
sources: [file paths this was derived from]
```

`origin: ai-derived` means *I read it out of the code* — treat as potentially stale. Mark an inferred
claim `(inferred)` inline. Where a reason cannot be established, write **"Reason unknown — inferred
from implementation"** rather than inventing one. An agent may not rewrite an `origin: human` line;
it may mark it superseded, citing Edward's instruction.

### `abstract:` — the load-or-skip line (capsules only, ADR-0064)

One sentence saying what the capsule is for. It is what an agent reads **instead of** the capsule,
to decide whether to open it, and `MAP.md` carries a verbatim copy in every routing row so that
decision can be made from the map alone. A capsule has exactly one summary line and this is it —
there is no `**Purpose:**` line in the body any more.

Four rules, all enforced by `scripts/memory-lint.mjs` as errors:

- present and non-empty;
- **at most 140 characters** — long enough to say what the area is, short enough that it cannot
  become a summary an agent has to weigh;
- **one sentence** — no `.`/`!`/`?` followed by a space and a capital. A single closing full stop is
  fine. This rules out `e.g. Something` mid-line;
- **plain and unquoted, never starting with `[`** — the front-matter reader here is a small regex,
  not a YAML parser: a leading `[` reads as a list and quotes are not stripped.

And one rule a script cannot check, so it is on you: **lead with scope, put judgement second.**
*"Who may do what, and to which rows — the most expensive thing on this project to re-derive"*
routes a task correctly on its first clause. *"The easiest thing on this project to get subtly
wrong"* is true, fits, and tells a reader nothing about whether to open the file. The test is
whether the **first clause alone** would route someone to the right capsule.

Changing an abstract means changing `MAP.md`'s copy in the same edit — the lint compares them
character for character and fails if they differ.

A convention-only edit like adding this field does **not** bump `verified:`: that date means "last
checked against the actual code", and rewriting a summary line checks nothing.

Health check: `node scripts/memory-lint.mjs`.

## Agent setup

Claude Code, Cursor, Antigravity and Gemini CLI all find this automatically — see
[../../AGENTS.md](../../AGENTS.md) §9 and each tool's adapter file.

**Claude Cowork** has no repository instruction file. Paste this once into the folder instructions
for this project:

> Read `docs/memory/README.md` before starting, then `docs/memory/MAP.md` to find the relevant
> context. Current source code always beats these notes. `AGENTS.md` is the binding ruleset.
> Never commit or push — Edward owns git.
