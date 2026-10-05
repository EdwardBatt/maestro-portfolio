# ADR-0006: Day-cell scheduler — dates as cells, hours as the booking unit

- **Status:** accepted (Edward, 2026-07-29)
- **Date:** 2026-07-29
- **Open Decision:** — (interaction-model decision; supersedes ADR-0004's *usage* for this surface)
- **Task(s):** M5 (rework), M5.4b, M5.5

## Context

The first M5 build used a continuous hour-precise timeline (dnd-timeline) with drag-to-create
spans. Edward's direction after using it: bookers think in **days and hours**, not minute
geometry — each date should be a cell, each cell an add action, the popup asking for project,
task (free text), provisional/confirmed, and number of hours. No sub-day division.

## Decision

1. **The scheduler is a day-cell grid**: rows = resources, columns = dates (7/14/28-day
   windows), one cell per resource-day. Each cell carries an add action; every creation path
   opens the same booking popup (project · task · provisional/confirmed · hours/day ·
   optional end date for multi-day).
2. **Hours are the input; load is derived** ("derive, don't ask", §2.2): standard working day
   = **8 hours** (constant now, per-office setting later), so 4h ⇒ 50% load. The capacity
   engine, ceilings, and warn-and-allow are unchanged underneath.
3. **Storage mapping**: a cell booking becomes a span starting 09:00 office-local on its
   date, lasting the entered hours. A **multi-day booking is a daily series** — one
   single-day instance per calendar day (series-vs-instance pattern, `freq='daily'`), so
   per-day capacity math stays exact and per-day warnings (weekends, blackouts) surface
   individually.
4. **Provisional = `tentative`, Confirmed = `confirmed`** — UI labels only; the state
   machine, approval routing, and DB invariant are untouched.
5. **Moves are drag-based between cells** (day↔day, row↔row) via native HTML drag-and-drop,
   still through the authoritative `reschedule` action (extended to allow a resource
   change); click-to-edit popup is the keyboard path and covers hour/state changes + cancel.
6. **dnd-timeline is removed from the app** (spike remains as reference). ADR-0004 is marked
   superseded for the scheduler surface; if a future surface genuinely needs sub-day
   precision (e.g. production shoot planning), dnd-timeline is the pre-validated candidate.

## Consequences

Easier: matches how bookers actually plan; simpler grid (plain CSS grid, no drag-geometry
library); per-day capacity is exact; cells make weekend/blackout warnings visually local.
Harder: sub-day precision is out of scope for this surface — two 4h bookings on one day
don't express *when* within the day (accepted: capacity math doesn't need it). Locked in:
hours-per-day is the booking vocabulary across the product (dashboards, exports).
