# Compass — durable orientation for AI agents working on a codebase

A folder of plain Markdown in git that any AI coding tool reads before it starts and writes to when
it finishes. No plugin, no database, no embeddings, no sync step. It survives a cleared context, a
new session, a different tool and a different model.

Compass answers one question well: **what should I read before touching this?** Everything in it
earns its place against that question or it does not go in.

Extracted from the Maestro repository, September 2026, where it lives at `docs/memory/` — the folder
kept that name for historical reasons and the system is called Compass everywhere else.

---

## What it is not

**It is not context-window management.** Compaction, retrieval and token budgeting are per-session
and mechanical. Compass is durable and hand-written, and its distinguishing move is that it
**routes**: a human-maintained index sends an agent to a small, named subset of notes and source
files, rather than a search returning whatever looked similar.

**It is not a wiki.** A wiki grows. Compass has a density cap, a staleness date on every note, and a
close routine whose stated bar is *most sessions should write nothing*.

**It is not where decisions live.** Decisions go in ADRs, rules go in your agent instructions file.
Two homes for one fact guarantees a contradiction, and the one nobody is reading will win.

## Why it works, in one line each

**Tiered reading.** Read until you have enough, then stop. Never load the whole folder.

**Routing beats searching.** The map is written in the words somebody would use to describe their
task, not in module names. It is the only file that must be excellent.

**Code always wins.** When a note contradicts the source, the source is right, the note is fixed in
that session, and the agent has to say so out loud. Never leave both readings standing.

**Everything is dated and attributed.** `verified:` is when it was last checked against real code.
`origin:` says whether a human asserted it or an AI inferred it — and an agent may never rewrite a
human line, only mark it superseded.

**A high bar for writing.** Most sessions add nothing. A trap only goes in if it cost real time AND
the cause was not visible from the symptom. That bar is what stops the folder becoming landfill.

**A script enforces what a script can.** Dead links, missing headers, over-long notes, stale dates,
and a summary line that has drifted from the map's copy of it.

**Every large file indexes itself.** A capsule is capped at 60 lines. `traps.md` cannot be capped —
you do not get to choose how much a codebase bites you — so it carries an index of symptoms instead,
and the lint fails on any entry the index does not list.

---

## The files

| File | Holds | Read when |
|---|---|---|
| `README.md` | the tiers and the authority order | every session |
| `MAP.md` | **the router** — task → note → source files → decisions | every session |
| `STATE.md` | what is built, part-built, broken; what is waiting on you | when the task depends on it |
| `traps.md` | things that cost real time where the cause was invisible | before debugging anything |
| `capsules/*.md` | one per domain, under 60 lines, pointing at source | the map names one |
| `sessions/*.md` | dated, rare, for work left genuinely mid-flight | the map or the close names one |
| `archive/` | out of circulation, never linted, never loaded | never |

## The two commands

`commands/compass-start.md` and `commands/compass-close.md` — drop them in your agent's command
folder (`.claude/commands/` for Claude Code) and invoke as `/compass-start` and `/compass-close`.

**`/compass-start <what you are about to do>`** routes, loads one capsule, opens the source it names,
and reports back *before touching anything*. Given no argument it proposes instead: it reads the
in-flight list, the newest session note, git and your tracker, and hands back a shortlist.

**`/compass-close`** writes back, walking traps → state → capsules → decisions → session note → the
map, and refuses to manufacture an entry.

### The trajectory block — port this even if you port nothing else

Every `/compass-start` ends with a fenced record of what context the task was actually given.
`/compass-close` later fills in one more line: **`missed:`** — what the task turned out to need that
the map did not point at.

It is the only mechanism here that answers *why did the agent miss X*, and it can only be written in
hindsight. In Maestro it is what revealed that four whole subject areas had no map row at all.

---

## Adopting it in a new repo

1. Copy `template/` to `docs/compass/` (or wherever you like — nothing depends on the path).
2. Copy `commands/*.md` into `.claude/commands/`.
3. Copy `scripts/compass-lint.mjs` into `scripts/`, and set `ROOT` at the top to your path.
4. Fill in `README.md`'s one-paragraph description of the project.
5. **Write `MAP.md` first and write it properly.** Everything else is optional; this is not.
6. Add one capsule for your densest domain — the one that is most expensive to re-derive.
7. Point your agent instructions file at it (`AGENTS.md`, `CLAUDE.md`, `.cursorrules` — all of them,
   if you use several tools; the whole point is that they share one store).
8. Leave `STATE.md` and `traps.md` nearly empty. They fill themselves as you work, and inventing
   entries on day one produces exactly the noise this system exists to avoid.

Then run `node scripts/compass-lint.mjs`. It ships **clean**, with four warnings pointing at example
source paths that do not exist in your repo — replace those `sources:` lines and the warnings go.
Any ERROR after copying is something you introduced, which is the point: from step one the lint is a
signal rather than noise.

### Writing the map

The left-hand column is the words somebody would actually type when asked what they are working on:
*"why was I refused?"*, *"the schedule grid"*, *"a query returning nothing"*. Not `auth`, `grid`,
`api`.

The test: if a newcomer describes their task out loud, does exactly one row match? If two match, the
rows are wrong. If none does, that is the most valuable thing the system can tell you — and it is
what `missed:` exists to catch.

### What to expect

The first week the map will be wrong in ways you only discover by using it. That is normal and it is
why `/compass-close` maintains the map explicitly: a subject with no row is invisible to the lint,
because the lint can only compare rows that exist.

---

## Does it save tokens?

Yes, but not by being small — by preventing the wrong reads.

Measured on Maestro, September 2026:

| | ≈ tokens |
|---|---|
| a routed session: README + map + one capsule | **5,700** |
| the whole store, read indiscriminately | 30,000 |
| **one** large source file read because nothing routed you away from it | 17,000 |

Two wrong files cost more than the entire store. That is the saving, and it scales with how large and
how confusing the codebase is — **on a small repo this system costs more than it returns.**

The honest costs: the README and map are ~4,600 tokens of overhead on **every** session, which is why
`/compass-start` is invoked deliberately rather than firing automatically. And `traps.md` reached
12,400 tokens before it was given an index; the index brought a debugging session from ~18,000 tokens
down to ~7,000 before it reads a line of code.

## Deliberate limits

**It does not scale to a hundred capsules.** At that point the map stops being scannable and you
want real search. Six is comfortable here.

**It is only as current as the last close.** The in-flight section of `STATE.md` is the most
perishable thing in the folder and says so in its own text; `git log` is always more authoritative.

**A human has to maintain the map.** No amount of tooling substitutes for somebody who knows the
codebase deciding what routes where. That is the cost, and it is the reason it works.

---

## What is deliberately not in the kit

**No ADR template.** Compass depends on decisions living somewhere other than itself, but it does not
care where. Use whatever you already have.

**No CI wiring.** The lint exits non-zero on an error, so `node scripts/compass-lint.mjs` drops into a
pipeline unchanged — but whether a stale note should fail a build is your call, not the kit's.

**No adapters for other tools.** The commands here are Claude Code's format. Cursor, Gemini and the
rest each want their own file; all any of them needs is one line pointing at the folder README, which
is the whole reason the store is plain Markdown in git.
