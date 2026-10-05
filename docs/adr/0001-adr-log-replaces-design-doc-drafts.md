# ADR-0001: ADR log replaces design-doc drafts; v15 frozen as baseline

- **Status:** accepted
- **Date:** 2026-07-28
- **Open Decision:** — (process decision)
- **Task(s):** 0.3.1, 0.3.2

## Context

The design evolved through fifteen numbered Word-document drafts. Draft-versioning served the
design phase well, but during the build it has two failure modes: decisions get buried in a
60-page document diff, and the doc and the code drift apart between drafts. The FullCalendar
licensing issue (see ADR-0002) demonstrated a third: a decision carried forward unexamined
through fourteen drafts because nothing forced it to be re-argued.

## Decision

Design Draft v15 (`docs/design/design-draft-v15.md`) is the **frozen baseline**. There will be
no v16. Every subsequent decision — resolutions of the 29 Open Decisions in §11, stack changes,
schema-shape choices, and changes to project rules (`AGENTS.md`) — is recorded as a numbered
ADR in `docs/adr/`, indexed in `docs/adr/README.md`, and cross-linked to the OD Gate table in
`docs/TASKS.md`. Accepted ADRs are immutable and are superseded, never edited.

## Consequences

Easier: decisions are individually reviewable, dated, and searchable; the evidence trail for
each choice survives; agents and humans share one authority order (ADRs → AGENTS.md → v15).
Harder: readers must consult v15 *plus* the ADR index rather than one document; the index must
be maintained with discipline. Locked in: v15's text is never edited, even when superseded —
the ADR is the correction.
