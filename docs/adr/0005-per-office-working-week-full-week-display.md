# ADR-0005: Working week is per-office data; the calendar always renders 7 days

- **Status:** accepted (Edward, 2026-07-29)
- **Date:** 2026-07-29
- **Open Decision:** — (schema-shape decision surfaced during M3 planning)
- **Task(s):** M3, M5.4, V1.11.2

## Context

Meridian operates offices with different working weeks: Baghdad and Cairo run Sunday–Thursday;
Dubai runs Monday–Friday (UAE's 2022 change); future commercial tenants may run any pattern.
Timelines that hide non-working days break when rows from different offices share a screen
(different columns missing per row), and agency work — shoots, events, go-lives — really
does land on weekends. Warn-and-allow (§2.2) requires such bookings be possible and visible.

## Decision

1. The working week is **data on the office**: `offices.working_days smallint[]` of ISO
   weekday numbers (1=Mon … 7=Sun), defaulting to `{1,2,3,4,5}`; Meridian seeds Baghdad/Cairo as
   `{7,1,2,3,4}` (Sun–Thu) and Dubai as `{1,2,3,4,5}`.
2. **The scheduling timeline always renders all 7 days.** Each resource row shades its own
   office's non-working days (quiet hatching, lighter than blackouts). No column is ever
   hidden.
3. Booking a resource on its office's non-working day **warns and allows** — never blocks,
   never disappears.
4. The same office data later drives the SLA clock's business-hours mode (V1.11.2) and
   lead-time arithmetic. Per-resource overrides and half-day patterns (e.g. Friday
   mornings) are deferred until real demand; the array-per-office model extends to both
   without breaking.

## Consequences

Easier: multi-office and cross-tenant views stay coherent; weekend work is first-class;
one source of truth for display, warnings, and clocks. Harder: day-level computations must
be done in the office's IANA timezone (already stored) — never the viewer's. Locked in:
7-day rendering is not a user preference; "hide weekends" is off the table.
