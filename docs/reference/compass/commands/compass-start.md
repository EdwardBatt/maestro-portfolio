---
description: Load the right project context for a task — tiered, not the whole vault
argument-hint: [what you are about to work on]
---

Orient yourself in this project before starting work on: **$ARGUMENTS**

**If `$ARGUMENTS` is empty, do not guess and do not read the vault — propose.** Read only these,
in this order:

1. `docs/compass/STATE.md` — the `## In flight right now` and `## Waiting on the person who decides` sections.
2. The newest file in `docs/compass/sessions/` — its `**In flight**` and `**Unresolved**` lines.
3. `git status --short` and `git log --oneline -5`.
4. `<your tracker>` — open items, ⚠️-gated ones first.

Offer the person who decides a numbered shortlist, most urgent first, one line each, saying what it is and why it
is urgent. Close it with a status line: what is uncommitted, and what the last commit was. Name the
`verified:` date of `STATE.md` — **the list is only as current as the last `/compass-close`, and he
must be able to see that.** If all four sources are silent, say so plainly rather than padding the
list.

Then **stop and wait.** Do not read a capsule. Do not start work. When he picks one, treat his
answer as `$ARGUMENTS` and run the protocol below from step 1.

Follow the tiered protocol. Stop as soon as you have enough — do not read the whole vault.

1. Read `docs/compass/README.md`.
2. Read `docs/compass/MAP.md` and find the row matching the task above.
3. Read **only** the capsule that row names.
4. Read `docs/compass/STATE.md` if the task depends on whether something is already built.
5. `docs/compass/traps.md` if the task involves debugging, the database, or an embed — **read its
   INDEX, then only the entries whose symptom could be yours.** Whole, this file becomes the most
   expensive thing in the store; its index is a fraction of it. The index lines are worded as
   SYMPTOMS, so match against what you are looking at.
6. Open the source files the capsule named. **They win over any note.**

Then report back, briefly:

- which capsule you loaded, and why that one;
- the ADRs that bind this work, by number;
- the source files you will need;
- anything in `STATE.md` saying this is already built, partly built, or known broken;
- any trap that applies;
- anything the memory says is unknown and needs the person who decides.

If a note contradicts what you find in the code, say so explicitly. The code is right — fix the note
in this session and set its `verified:` date to today.

Then **end the report with a trajectory block**  — what context this task was actually
given. Fenced, exactly these keys, so it can be pasted into a session note later and grepped:

```text
trajectory: 2026-08-31 — <the task, in a few words>
  capsule: capsules/<name>.md
  adrs:    0037, 0041
  source:  src/app/permissions.tsx, supabase/functions/_shared/authz.ts
  also:    STATE.md, traps.md
  missed:  —
```

- `capsule:` — the one you loaded, or `none — no row in MAP.md matched` if the map did not route you.
  Say which, honestly; a task the map cannot route is the most useful thing this block records.
- `adrs:` — numbers only, from the map row and anything the capsule named.
- `source:` — the files you actually opened, not the ones the capsule listed.
- `also:` — `STATE.md` / `traps.md` if you read them. Omit the line if you read neither.
- `missed:` — always `—` here. It can only be filled in afterwards, by `/compass-close`, once the task
  has shown what it really needed.

The block is cheap and it is the only record of what you were working from. Emit it even when the
answer is "nothing matched".

Do not start making changes until you have reported.
