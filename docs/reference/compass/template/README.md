---
type: map
status: current
origin: human
verified: 2026-09-08
sources: [<your agent instructions file>, <your decision log>, <your tracker>]
---

# Project orientation — start here

Shared, agent-independent memory for **<PROJECT>**. One store, read and written by every AI tool
that works on this repository. Plain Markdown in git: no plugins, no database, no sync step.

<PROJECT> is <one paragraph: what it does, the stack, and what stage it is at. An agent reads this
to know what kind of thing it is looking at. Keep it to five lines.>

## Read in this order. Stop as soon as you have enough.

| Tier | Read | When |
|---|---|---|
| 0 | this file | every session |
| 1 | [MAP.md](MAP.md) | every session — it routes you to the rest |
| 1 | [STATE.md](STATE.md) | when the task depends on what is already built |
| 1 | [traps.md](traps.md) | before debugging anything that "should work" |
| 2 | one capsule from [capsules/](capsules/) | the map names it |
| 3 | the actual source files | always, last, and they win |

Do **not** read the whole folder. Do not read a capsule the map did not name for your task.

## What wins when sources disagree

1. **Current source code, migrations, live schema, running config.** Always.
2. **Accepted decisions** — <your ADR folder or equivalent>.
3. **<your agent instructions file>** — the binding rules.
4. **<your tracker>** — what is built and what is planned.
5. **This directory** — orientation, dated, assumed stale until checked.
6. **sessions/** — most recent, least authoritative.

Code beats documentation. An explicit human decision beats AI inference. A current decision beats a
historical one.

**If a note contradicts the code: the code is right. Fix the note in the same session, and say so.**
Never leave both readings standing.

## What belongs here — and what does not

Orientation (where to look), state (what is built), and traps (expensive lessons). That is all.

It does **not** hold decisions (those are ADRs), rules (those are the instructions file), the schema,
source code, or anything one grep would answer.

## Writing to memory

Update the existing note. A new file needs a reason. Then set `verified:` to today.

- A discovery that cost real time → [traps.md](traps.md)
- Something built, or found already built → [STATE.md](STATE.md)
- Orientation that will be true next month → the capsule
- A decision → an ADR, never here
- A session note → only when asked, or when work is left genuinely mid-flight

Front matter on every note:

```yaml
type: capsule | state | trap | session | map
abstract: <one sentence>        # CAPSULES ONLY, and mandatory there
status: current | needs-check | superseded
origin: human | ai-derived      # human = a person said it, or it is an accepted decision
verified: 2026-09-08            # last date this was checked against the actual code
sources: [file paths this was derived from]
```

`origin: ai-derived` means *read out of the code* — treat as potentially stale. Mark inference
`(inferred)`. Where a reason cannot be established, write "Reason unknown — inferred from
implementation" rather than inventing one. An agent may not rewrite an `origin: human` line; it may
mark it superseded, citing who said otherwise.

### `abstract:` — the load-or-skip line (capsules only)

One sentence saying what the capsule is for. It is what an agent reads **instead of** the capsule, to
decide whether to open it, and `MAP.md` carries a verbatim copy in every routing row so that decision
can be made from the map alone.

Enforced by the lint: present, at most 140 characters, one sentence, unquoted, never starting `[`.

And one rule no script can check: **lead with scope, put judgement second.** The test is whether the
first clause alone would route somebody to the right capsule.

Changing an abstract means changing `MAP.md`'s copy in the same edit — the lint compares them
character for character.

Health check: `node scripts/compass-lint.mjs`.
