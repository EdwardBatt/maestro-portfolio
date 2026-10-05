---
type: map
status: current
origin: human
verified: 2026-09-08
sources: []
---

# Session notes

**Most sessions do not get one.** Write one only when asked, or when a session leaves work genuinely
mid-flight that the next session must pick up.

A note written to record that a session happened is landfill. The test: would somebody starting
tomorrow be worse off without it?

## Format

`YYYY-MM-DD.md`, front matter `type: session`, and these headings — omit any that would be empty:

- **Changed** — what shipped, with tracker ids
- **Why** — what prompted it, if not obvious from the tracker
- **Discovered** — one line per trap, linking to `traps.md` where the detail now lives
- **Decided** — one line per decision, linking to the ADR where it now lives
- **Unresolved** — what is waiting on a person
- **In flight** — what is half-done, and where the next session should start
- **Loaded** — the trajectory block (below)

## The trajectory block

`/compass-start` emits it; `/compass-close` fills in `missed:`. Fenced, exactly these keys, so it can
be grepped:

```text
trajectory: YYYY-MM-DD — <the task, in a few words>
  capsule: capsules/<name>.md
  adrs:    0037, 0041
  source:  src/one.ts, src/two.ts
  also:    STATE.md, traps.md
  missed:  —
```

`missed:` is the field worth the trouble: what the task turned out to need that the map did not point
at. It is the only evidence for *why did the agent miss X*, and it can only be written in hindsight.

## Archiving

Once a note's content is durable, promote it — trap to `traps.md`, orientation to a capsule, decision
to an ADR — then move the file to `archive/`. The lint skips that folder.
