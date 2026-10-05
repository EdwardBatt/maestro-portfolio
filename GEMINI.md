# Maestro — Gemini

Read [`AGENTS.md`](AGENTS.md) at the repository root. It is the canonical, binding ruleset for this
project, and it applies to you exactly as it does to every other agent. If any suggestion conflicts
with it, `AGENTS.md` wins.

Then read [`docs/memory/README.md`](docs/memory/README.md) and follow its tiered protocol:
`README` → [`docs/memory/MAP.md`](docs/memory/MAP.md) → the one capsule the map names → the source
files. Do not load the whole vault.

That memory is shared with every other AI tool working on this repository. When you learn something
durable, write it there — not into a Gemini-specific file. There is no Gemini memory; there is one
project memory.

Three rules worth repeating here because they are the ones most often broken:

- **Current source code always beats these notes.** If a note and the code disagree, the code is
  right — fix the note in the same session.
- **Never commit, push, or apply a migration.** Edward owns git and the database. Prepare files and
  stop.
- **Decisions go in `docs/adr/`**, never into memory notes.

`.gemini/settings.json` in this repository also points Gemini CLI's context loader at `AGENTS.md`, so
the ruleset loads whether or not this file is read first.
