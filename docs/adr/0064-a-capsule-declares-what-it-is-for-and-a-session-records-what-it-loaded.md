# ADR-0064: A capsule declares what it is for, and a session records what it loaded

- **Status:** accepted (Edward, 2026-08-31)
- **Date:** 2026-08-31
- **Open Decision:** — (raised by an evaluation of `docs/memory/` against `volcengine/OpenViking`,
  31 Aug 2026)
- **Task(s):** new `I33`. Changes `AGENTS.md` §9 conventions and adds a CI-able lint rule, so it is
  ADR-gated by `AGENTS.md` §8. Relates to nothing in the product.

## Context

`docs/memory/` is the shared, agent-independent memory added in August: `README.md` → `MAP.md` →
one capsule → the source. An evaluation compared it against **OpenViking** and found the core idea
already implemented — tiered loading, with each tier deciding whether the next is needed. Two of
that system's cheaper ideas are not implemented here, and both are dependency-free.

### What is actually missing

**1. There is no machine-readable "should I open this?" line.** The tiered protocol tells an agent
to read the capsule the map names, but nothing tells it what a capsule *contains* before it opens
one. Today the only summary is a `**Purpose:**` line in the body — which is only readable *after*
paying the cost of the read. The map's routing column (`roles, grants, who-can-do-what…`) is a
trigger phrase, not a description; an agent whose task sits between two rows has no cheap way to
judge which capsule is the right one, and the protocol explicitly forbids reading both.

The six existing Purpose lines are also not the right shape for this job. They run to two sentences
and carry judgement as well as scope:

> **Purpose:** who may do what, and to which rows. The most expensive thing on this project to
> re-derive, and the easiest to get subtly wrong.

The second sentence is worth keeping, and on its own it is useless for a load-or-skip decision.
Rewritten as one sentence it is 128 characters — which is what makes d.4 below possible.

**2. Nothing records what context a task was given.** When an agent misses something — the duplicate
route in `router.tsx` that hid `/campaigns/:id` for four days, the `sub_task_reviewers` omission that
locked eleven of twenty-seven users out of chat — the interesting question afterwards is *what did it
have loaded when it missed it?* That is unanswerable today. Session notes record what changed, never
what was read. OpenViking calls this the retrieval **trajectory**, and it is the only part of a
context system that makes its own failures diagnosable.

### Options weighed

**On the abstract:**

| Option | Verdict |
|---|---|
| Do nothing; agents read the Purpose line | Rejected — it is inside the file, so it cannot inform the decision to open the file |
| Abstract in front matter, Purpose line stays unchanged | Rejected — the two sit four lines apart in the same file, so this is not "a machine line and a human line for different audiences", it is the same sentence written twice on one screen, with nothing able to check that they still agree |
| Abstract carries the scope, the Purpose line is cut down to only the judgment it adds | Rejected, narrowly (Edward, 31 Aug) — it does fix the duplication, but it leaves **two** summary lines to keep true and needs a second label invented for the remainder. Measured against the cap, it is unnecessary: **all six** existing judgment sentences fit inside 140 characters alongside their scope sentence |
| Abstract **replaces** the `**Purpose:**` line entirely | **Chosen** (Edward, 31 Aug: *one fact, one line is the right call*) — every fact lives exactly once, in one field, which is the only version with no sync burden at all. It also **reclaims two body lines in every capsule** against the 60-line density cap, since front matter is not counted as content |
| A separate `docs/memory/ABSTRACTS.md` index | Rejected — a seventh file to keep in sync, and it duplicates `MAP.md`'s job |

**On surfacing it in `MAP.md`:**

| Option | Verdict |
|---|---|
| A fifth column | Rejected — the table is already four columns of long cells; a fifth makes the raw text unreadable, and raw text is how agents read it |
| Inline in the Capsule cell, copied from the capsule | **Chosen** — sits next to the link it qualifies, adds no column |
| Link only, agent opens the capsule to see the abstract | Rejected — that is the cost the abstract exists to avoid |

Copying the abstract into `MAP.md` creates a second copy, which is exactly the rot this vault is
built to resist. The answer is not to avoid the copy but to **check it**: the lint requires the map's
copy to be byte-identical to the capsule's own `abstract:`. Duplication that a script enforces is not
drift, it is a cache.

**On the trajectory:** the alternative was a separate log file, one entry per session. Rejected —
it would be written every session regardless of value, which is precisely the landfill
`sessions/README.md` was written to prevent. The trajectory rides in the session note that would
have been written anyway, and nowhere else.

## Decision

1. **Every note of `type: capsule` carries a mandatory `abstract:` front-matter field**: one
   sentence stating what the capsule is for, at most **140 characters**. It is the L0 load-or-skip
   signal — the thing an agent reads *instead of* the capsule, to decide whether to read the capsule.

2. **The rule is exactly four constraints**, so that a script can hold it:
   - present and non-empty after trimming;
   - **≤ 140 characters**;
   - **one sentence** — a sentence break is `[.!?]` followed by whitespace followed by an
     upper-case letter or an opening quote/bracket. A single terminal `.`/`?`/`!` is allowed.
     Consequently an abstract may not use a mid-line abbreviation followed by a capital
     (`e.g. Bookings`); at 140 characters it has no room for one anyway;
   - **a plain unquoted scalar that does not begin with `[`.** `memory-lint.mjs` reads front matter
     with a nine-line regex parser in which a leading `[` means "list" and quotes are not stripped.
     The constraint is on the writer because the alternative is a YAML dependency, and
     `AGENTS.md` §1 makes every dependency a decision.

   140 is chosen so the line fits a `MAP.md` table cell without wrapping in a terminal, and so it
   cannot grow into a summary of the capsule — a summary an agent must weigh is not a skip signal.

3. **The abstract is descriptive, not causal.** It states what the capsule covers. Where a reason
   is not established it is not invented, per `AGENTS.md` §9. The six backfilled abstracts are
   derived from each capsule's existing Purpose line and inherit that capsule's `origin:` —
   `ai-derived` for all six today.

   **Backfilling an abstract does not bump `verified:`.** That field means "last checked against
   the actual code" (`README.md`), and rewriting a summary line checks nothing. Bumping it here
   would launder six notes as freshly verified when none of them was re-read against source. A
   convention-only edit leaves `verified:` alone; this generalises beyond this ADR.

4. **The `abstract:` field replaces the `**Purpose:**` body line, which is deleted.** They said the
   same thing four lines apart in the same file. Every one of the six existing Purpose lines fits
   inside 140 characters as a single sentence — scope and judgement together — so nothing is lost by
   collapsing them, and the alternative of keeping a trimmed second line leaves a second thing to
   keep true for no gain.

   Where a future capsule's judgement genuinely will not fit the cap, it goes into the **body prose
   under a real heading** — not into a restored second summary line. A capsule has exactly one
   summary, and it is the abstract.

   Front matter is not counted against the `CAPSULE_MAX_LINES` density cap, so the deletion
   **reclaims two body lines in each of the six capsules**.

5. **The abstract leads with scope; judgement comes second, never first** (Edward, 31 Aug). Now that
   one sentence carries both, the order is load-bearing: an agent reads the abstract *instead of*
   the file, and a line that opens on judgement — *"the easiest thing on this project to get subtly
   wrong"* — is a teaser. It is true, it fits the cap, and it does not answer **"should I open
   this?"**, which is the only question the field exists to answer. The test for a new abstract is
   that its **first clause alone** would route a task correctly.

   This is a writing rule, not a lint rule: no script can tell scope from judgement, and a bad
   regex here would reject good abstracts. It is enforced by review, like the Purpose lines it
   replaces were.

6. **`MAP.md` carries each capsule's abstract inline in its routing row**, immediately after the
   capsule link, copied verbatim. An agent can then judge relevance from `MAP.md` alone. **The lint
   requires the copy to match the capsule's `abstract:` exactly**, so the two cannot drift.

7. **`scripts/memory-lint.mjs` enforces d.2 and d.6 as ERRORS, not warnings.** A missing, empty,
   over-long or multi-sentence abstract, and a `MAP.md` copy that does not match, are all provably
   wrong at the moment they are written — which is the file's existing error/warning line
   (errors are provable now; warnings are a human's judgement about staleness). The script stays
   **zero-dependency**, in the shape of `check-licenses.mjs` and `check-authz-call-path.mjs`.

8. **`/memory-start` ends its orientation report with a trajectory block** — compact, fenced, and
   copy-pasteable, with fixed keys so it can be grepped later:

   ```text
   trajectory: <YYYY-MM-DD> — <the task, in a few words>
     capsule: capsules/<name>.md          # or: none — no row matched
     adrs:    0037, 0041
     source:  src/app/permissions.tsx, supabase/functions/_shared/authz.ts
     also:    STATE.md, traps.md          # tier-1 notes read; omit the line if none
     missed:  —                           # filled in at close, never at start
   ```

   `missed:` is the field the whole idea is for, and it can only be filled **afterwards**: what the
   task turned out to need that the map did not route to. At start it is always `—`.

9. **`/memory-close` records that trajectory in the session note, when a session note is being
   written** — under a `**Loaded**` heading, with `missed:` completed in hindsight. It is written
   **nowhere else**.

10. **Trajectory logging never causes a session note to exist.** `sessions/README.md`'s rule is
   unchanged and binding: notes are written when Edward asks, or when work is left genuinely
   mid-flight. Most sessions still produce no file. A trajectory is not a reason to write one —
   if there is no note, the trajectory is reported to Edward in the session and discarded.

11. **`docs/memory/README.md`'s front-matter spec documents `abstract:`**, marked as capsule-only.

12. **The 65 ADRs in `docs/adr/` are out of scope.** They are not tiered-loaded — `MAP.md` routes to
    them by number and the index in `docs/adr/README.md` already carries a dense one-paragraph
    summary of each, which is a fuller version of the same signal. Backfilling `abstract:` across
    them is possible future work and is deliberately not started here; it would be a second,
    unchecked copy of the index rows, and this ADR's own d.6 says duplication is only safe when a
    script holds it.

## Consequences

**Easier.** An agent decides which capsule to open from `MAP.md` alone, without opening one to find
out — the case the tiered protocol handles worst today, where a task sits between two rows. A capsule
that has quietly grown beyond its abstract now has a visible mismatch. And when an agent misses
something, the session note says what it had loaded when it missed it, which is the difference
between fixing the map and guessing at it.

**Harder.** Writing an abstract is genuinely constrained: 140 characters, one sentence, no
abbreviation-plus-capital, no leading `[`. That is a real cost paid six times now and once per new
capsule, and it is sharper than it looks because the abstract is now the capsule's **only** summary
(d.4) — a sentence that will not fit has nowhere cheap to go. Two things still describe a capsule
after this: its `abstract:` and its `MAP.md` routing trigger (`roles, grants, who-can-do-what…`).
The lint holds the abstract's copy in `MAP.md` byte-for-byte; it cannot hold the routing trigger,
which is a lookup key rather than a description, and is left unenforced deliberately.

**Locked in.** The 140-character cap and the one-sentence rule become load-bearing — `MAP.md`'s
layout assumes a cell that does not wrap. The `MAP.md`-must-match-capsule invariant means the map
cannot be edited independently of the capsule it routes to; that is the point, and it will be
mildly annoying at least once. The trajectory's key names (`capsule`, `adrs`, `source`, `also`,
`missed`) become a format that later sessions grep, so renaming a key later orphans the notes
already written.

**Not affected.** No product code, no schema, no dependency, no CI job beyond the existing
`node scripts/memory-lint.mjs`. Nothing here is licensed, paid, or reaches the database.

## Noted, not addressed here

Found while confirming this ADR's number, recorded so it is not lost, and **deliberately not fixed
in this change** (Edward, 31 Aug — track separately): **the two routing documents are stale on ADR
numbers.** `CLAUDE.md` says the ADR log runs "0001–0042" and `docs/memory/MAP.md`'s decision column
cites nothing above 0042, while `docs/adr/` holds 65 files up to 0063. Numbering itself is sound —
no duplicates, no gaps — so this is a documentation lag, not a collision. Its practical cost is that
an agent routed by either file can believe a decision family stops in mid-August: the chat rows in
`MAP.md` already cite 0062 and 0063 by hand, which is how the gap became visible.

