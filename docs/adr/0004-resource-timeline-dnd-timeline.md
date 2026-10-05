# ADR-0004: Resource timeline built on dnd-timeline (headless)

- **Status:** accepted (Edward, 2026-07-28)
- **Date:** 2026-07-28
- **Open Decision:** — (closes tracker task 0.1.6; consequence of ADR-0002)
- **Task(s):** 0.1.6, M5

## Context

The design doc's stack table named FullCalendar (resource-timeline), removed by ADR-0002
(premium/GPLv3). A working spike (`spike/timeline/`) built the same scenario — 150 resources
across Meridian-shaped departments, ~300 bookings including a forced 3-way overlap cluster,
blackout ranges, drag interactions, EN + AR — in the two shortlisted permissive libraries,
measured headlessly with Playwright:

| Criterion | dnd-timeline v3 (MIT) | vis-timeline (MIT/Apache-2.0) |
|---|---|---|
| 150 rows / ~300 items initial render | ~0.3–0.4s | ~0.3–0.5s |
| Drag-move precision | 200px commanded → 200px moved | same |
| Drag-to-create / resize | yes (built in spike) | yes (built-in editable) |
| Overlap stacking per row | 3 distinct lanes (groupItemsToSubrows) | built-in stack |
| Blackout ranges | overlay div via valueToPixels (spike-proven) | native `background` items |
| RTL | **native** — `dir="rtl"` on a parent, logical properties throughout | works via `rtl: true` option |
| Programming model | headless React hooks; state stays in React (fits TanStack Query) | imperative vanilla-JS class wrapped in useEffect; DataSet↔React state sync is ours to maintain |
| Look & feel | 100% ours — the spike already renders as a product surface | CSS overrides against shipped widget styling |
| Cost side | we own the time axis, zoom/pan UX, and (later) row virtualization — upstream MIT examples exist for each | integration seam grows with every custom interaction (warn-and-allow prompts, load colouring, role scoping) |

## Decision

Build Maestro's scheduling timeline (M5) on **dnd-timeline** (MIT, headless, dnd-kit-based).
Rationale: the scheduler is the substrate of a bespoke, role-scoped, bilingual product —
control of the render layer is a requirement, not a luxury. dnd-timeline keeps all state in
React (one data flow with TanStack Query), supports RTL natively at the layout-primitive
level, and the spike demonstrates every acceptance criterion including the parts we must own
(blackouts, creation ghost). vis-timeline is the documented fallback if M5 reveals
unacceptable build cost: the spike page proves it covers the same criteria out of the box,
at the price of an imperative integration seam that would grow with every bespoke
interaction.

## Consequences

Easier: unconstrained UX (warn-and-allow, load colouring, role-scoped chrome), RTL by
construction, no widget-CSS fights, tiny dependency surface. Harder: M5 includes building
the timeline chrome ourselves — the time axis is now *proven* cheap (the spike includes a
hand-built day/hour axis with locale-aware EN/AR labels, mirrored in RTL: ~45 lines +
CSS); zoom/pan and eventually row virtualization remain to build (upstream MIT examples:
`timeaxis`, `virtual`, `performance`). Locked in: scheduler interactions are our code —
FullCalendar-style config-driven shortcuts are off the table. The spike code in
`spike/timeline/` is the reference starting point for M5.
