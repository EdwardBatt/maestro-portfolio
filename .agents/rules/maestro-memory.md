# Maestro — shared project memory

`AGENTS.md` at the repository root is the canonical, binding ruleset. Antigravity loads it ahead of
this file; if anything here conflicts with it, `AGENTS.md` wins.

**Shared memory lives in `docs/memory/`.** It is the same store every AI tool on this repository
reads and writes — there is no Antigravity-specific memory.

Start of a task, in order, stopping as soon as you have enough:

1. `docs/memory/README.md` — how the memory works and what beats what.
2. `docs/memory/MAP.md` — routes your task to one capsule and to the source files that matter.
3. That capsule, from `docs/memory/capsules/`.
4. The actual source files. **They always win over a note.**

Also read `docs/memory/traps.md` before debugging anything that should work but does not, and
`docs/memory/STATE.md` before assuming a feature exists.

Do not read the whole vault.

When you learn something durable, write it back: a costly discovery goes in `traps.md`, a change in
what is built goes in `STATE.md`, lasting orientation goes in the capsule. **Decisions go in
`docs/adr/` as an ADR, never into memory.**

Never commit, push, or apply a migration — Edward owns git and the database.
