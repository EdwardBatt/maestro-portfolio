---
description: Write what this session learned back into shared memory
argument-hint: [optional — focus on a particular thing]
---

Update `docs/memory/` with what this session actually learned. $ARGUMENTS

Be strict about what qualifies. Most sessions should change one or two files, and some should change
none. If nothing here is durable, say so and stop — do not manufacture an entry.

Work through these in order:

**1. Traps** (`docs/memory/traps.md`) — did anything take more than a few minutes to understand, where
the cause was not visible from the symptom? Add it, with what it cost. Skip general advice; this file
is for things that actually bit. **Add its line to the INDEX at the top in the same
edit** — an entry the index does not list is one nobody will read, and `scripts/memory-lint.mjs`
fails the build on the mismatch. Word the index line as the SYMPTOM, not the cause.

**2. State** (`docs/memory/STATE.md`) — did something move between working / partial / broken? Did
you find something already built that was listed as outstanding, or listed as built and not? Move it,
and mark whether it is confirmed or suspected. Also reconcile `## Waiting on Edward` — remove what
he answered this session, add what this session raised.

**3. Capsules** (`docs/memory/capsules/`) — did the shape of an area change in a way that will still
be true next month? Edit the existing capsule; do not add a new one unless a whole cluster of work has
no home. Keep it under 60 lines and keep it pointing at source rather than quoting it.

**4. Decisions** — if a decision was made, it becomes an **ADR** (`docs/adr/`, skill `maestro-adr`),
not a memory note. Memory records orientation, never decisions.

**5. Session note** — only if Edward asked for one, or the session leaves work genuinely mid-flight
that the next session must pick up. Format is in `docs/memory/sessions/README.md`.

When you do write one, it carries the session's **trajectory** under `**Loaded**` (ADR-0064): the
block `/memory-start` emitted, with `missed:` now filled in — what this task turned out to need that
`MAP.md` did not route you to. That is the field worth the trouble: it is the only evidence for *why
did the agent miss X*, and it can only be written in hindsight. If nothing was missed, `missed: —`.
If `/memory-start` was never run, say `trajectory: not recorded — /memory-start was not used` rather
than reconstructing one from memory.

**The trajectory never justifies a session note.** If rule 5 says no note, there is no note; report
the trajectory to Edward in the session and let it go. A file written only to hold a trajectory is
exactly the landfill `sessions/README.md` exists to prevent.

**6. The map** (`docs/memory/MAP.md`) — did this session work on a subject the map has no row for?
The `missed:` line you just wrote is the input to this question. If the answer is yes, add a row: the
subject in the words someone would actually use, the source files, and the ADRs. Route it to a
capsule only if one genuinely fits; the "Not covered by a capsule" table is the right home for most.

`scripts/memory-lint.mjs` **cannot catch this.** It compares rows that exist against the capsules
they name; a subject with no row at all is invisible to it. This step is the only thing standing in
for that.

Rules while writing:

- Update in place. A new file needs a reason.
- Set `verified:` to today on every note you touch.
- Mark inference as `(inferred)`. Where a reason cannot be established, write "Reason unknown —
  inferred from implementation" rather than inventing one.
- Never rewrite an `origin: human` line. Mark it superseded and cite Edward's instruction.
- Do not paste source code into a note.

Then run `node scripts/memory-lint.mjs` and fix anything it reports.

Finally, tell Edward in a few lines which files you changed and why — and **anything the code
contradicted**: a note that turned out to be wrong, and what it now says. Those are the clearest
evidence a note is drifting, and they are otherwise invisible to him, buried inside an edit. Then
stop. Do not commit.
