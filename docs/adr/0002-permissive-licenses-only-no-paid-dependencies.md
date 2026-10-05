# ADR-0002: Permissive licenses only; no paid dependencies without authorization

- **Status:** accepted
- **Date:** 2026-07-28
- **Open Decision:** — (extends the §9 licensing basis)
- **Task(s):** 0.1.6, M5

## Context

The design doc's §9 licensing rule barred copyleft *source foundations* (Worklenz AGPL,
LibreBooking GPL as design-references-only) but was never applied to frontend dependencies.
FullCalendar (resource-timeline) sat in the §3 stack table from draft v2 through v15 with no
license or cost analysis; the resource-timeline view is in fact a premium plugin — commercial
(from $480/yr) or GPLv3, both unacceptable (cost unauthorized; GPL barred by §9). The §3.3
running-cost estimate never included it. Edward confirmed paid dependencies were never
authorized.

## Decision

1. All dependencies (runtime, dev, and embedded assets) must be permissively licensed:
   MIT, Apache-2.0, BSD, ISC. MPL-2.0 (file-level copyleft) requires its own ADR
   (anticipated for the self-hosted Collabora service, which is a deployment, not linked code).
2. Paid or commercially-licensed components require explicit written authorization from
   Edward **before** installation, recorded in an ADR.
3. License is checked before `npm install`, and CI enforces a license allowlist.
4. FullCalendar premium packages are removed. The resource-timeline library is selected by
   the task 0.1.6 spike from permissive candidates (dnd-timeline recommended primary;
   vis-timeline; react-calendar-timeline), judged against: resource rows at pool scale,
   drag create/move/resize, overlapping items per row, blackout ranges, **RTL**, React+TS,
   performance. The winner gets its own ADR.

## Consequences

Easier: clean IP position for commercialization; zero license fees; no key management.
Harder: the timeline surface requires more build effort than the premium drop-in — accepted,
since the scheduler UX is bespoke (warn-and-allow, load colouring, role scoping) regardless.
Locked in: any future paid tool (e.g. Collabora support subscription, Frame.io API tier)
must arrive via ADR with explicit authorization.
