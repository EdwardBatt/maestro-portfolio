# ADR-0047: Elective and legacy-string permissive licences are accepted

- **Status:** accepted (Edward, 27 Aug)
- **Date:** 2026-08-27
- **Open Decision:** — (extends the ADR-0002 §1 allowlist, in the shape ADR-0003 established)
- **Task(s):** unblocks `I14.3` (ADR-0044); relates to ADR-0002 (licensing basis), ADR-0003 (the
  first allowlist extension)

## Context

ADR-0044 needs `mammoth` to read `.docx` briefs. `mammoth@1.12.1` is **BSD-2-Clause**, already on the
allowlist. Three of its transitive dependencies are not, and `npm run check:licenses` fails in CI:

| Package | Declared | What it actually is |
|---|---|---|
| `duck@0.1.12` | `BSD` | LICENSE text is **verbatim BSD-2-Clause**. Same author as `mammoth`. It declares the pre-SPDX string `BSD`, and the gate matches exact SPDX ids. |
| `jszip@3.10.1` | `MIT OR GPL-3.0-or-later` | Genuinely dual-licensed: *"At your choice you may use it under the MIT license **or** the GPLv3 license."* |
| `pako@1.0.11` | `MIT AND Zlib` | Shipped LICENSE is plain MIT; `Zlib` covers the zlib-derived portion. Zlib is OSI-approved and non-copyleft. |

None of this is exotic. A `.docx` is a zip archive of XML, so reading one means unzipping (`jszip`)
and inflating (`pako`). The dependency tree is the file format's shape, not a packaging choice.

**The gate is not malfunctioning.** `scripts/check-licenses.mjs` splits a compound SPDX expression and
requires *every* id to pass — treating `OR` like `AND` on purpose, with the comment *"an OR with one
allowed side still needs review"*. That is correct behaviour: **electing a licence is a human act**,
and a script must not elect MIT on the project's behalf. The gate did its job by stopping and asking.

Edward, 27 Aug, asked what the issue was, was given the three strings and the reasoning, and
answered: **"I clear the licences"**.

### The forces

**Nothing here is copyleft in effect.** The GPL half of `jszip` is an option the project declines;
`Zlib` and BSD-2-Clause impose attribution and nothing else. No obligation reaches Maestro's source.

**But "permissive in substance" is exactly the argument that erodes a licence gate.** If every future
failure is waved through on the grounds that somebody read the text and it seemed fine, the gate
becomes a formality. So the decision is written down per-licence, not per-package, and the gate keeps
failing for anything not named here.

**An election has to be recorded somewhere a person will find it.** `jszip`'s MIT is a choice the
project makes. If it lives only in an allowlist entry, the next person to look sees a package that
"passes" and never learns a decision was made.

## Decision

1. **`Zlib` joins the ADR-0002 allowlist.** OSI-approved, non-copyleft, attribution-only —
   the same class as BSD-2-Clause and `0BSD`, which are already allowed. No further condition.

2. **The project elects MIT for `jszip`**, as its licence expressly permits. This is the election,
   recorded here so it is a decision and not an accident. The GPL-3.0-or-later option is **declined**
   and must stay declined: taking it would put a copyleft obligation on a bundled dependency, which
   ADR-0002 exists to prevent.

3. **`duck@0.1.12` is accepted as BSD-2-Clause** on the strength of its licence text, which is the
   two-clause text verbatim. The declared string `BSD` predates SPDX. This is an acceptance of **one
   pinned package at one version**, not of the bare string `BSD` in general — a future package
   declaring `BSD` fails the gate and needs its own look, because `BSD` has historically also meant
   the four-clause variant with the advertising clause.

4. **The checker keeps treating `OR` as `AND`.** It is not relaxed, and no per-package override
   mechanism is added. An elective licence should stop CI and reach a person; that is the whole value
   of the gate. The cost is one ADR per election, which is the correct price.

5. **The allowlist entries carry their reason in a comment**, as `MPL-2.0` already does for ADR-0003,
   so the next reader finds the decision from the code rather than by searching.

## Consequences

**Easier.** `.docx` brief upload ships. `check:licenses` goes green, unblocking `I14.3`.

**Harder.** The allowlist now has two entries that are conditional on a decision rather than
self-evident (`MPL-2.0` from ADR-0003, `Zlib` from here) plus one pinned-package acceptance. Anyone
auditing licensing has to read three ADRs, not one. That is the price of not having a silent override
mechanism, and it is the right way round.

**Locked in.** `Zlib` is allowed outright. MIT is elected for `jszip` and GPLv3 declined. `duck` is
accepted at `0.1.12` only. The bare string `BSD` is **not** allowlisted — a future package declaring
it still fails. The `OR`-as-`AND` rule stands.

**Cost.** No dependency, no service, no money. One allowlist line, one pinned exception, this ADR.

**Testing.** `npm run check:licenses` passes with `mammoth` installed, and still fails if a package
declaring an unlisted licence is added — verify by adding one temporarily rather than assuming.
