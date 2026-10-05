# ADR-0007: Team-launch deviation — ship the booking calendar to production first

- **Status:** accepted (Edward, 2026-07-30)
- **Date:** 2026-07-30
- **Open Decision:** — (phasing change to §12; architecture unchanged)
- **Task(s):** Phase L (L1–L5); defers M6–M11 as noted

## Context

Meridian has asked for the booking calendar to go live for the whole team now. The design doc's
§12 phasing (complete MVP → v1 → phase 2) assumed no interim production launch. Putting the
day-cell scheduler in front of the entire team — bookers, leads, creatives, support — pulls
forward capabilities the tracker had scheduled later (RBAC administration, task-list views,
personal calendars, deployment, password flows) and defers MVP items that do not gate team
usage (client portal, joint-project cross-tenant hardening, campaign calendar projection,
full Tier-1 dashboard).

## Decision

1. Insert **Phase L (Team Launch)** into the tracker, sequenced L1→L5: RBAC & data
   administration; calendar views (master grid + filters, My calendar, project calendar,
   month overview); task-list views (bookings table, My tasks, per-project); launch
   infrastructure (maestro-prod on a paid tier, Vercel frontend, Auth URL config,
   set/reset-password screen); pilot hardening (Playwright smoke suite, RTL pass, real Meridian
   data load, pilot checklist + rollback).
2. **Whole team gets accounts at launch** — creatives/support land on My calendar / My tasks
   (read-only over their own resource's bookings), which delivers the essential slice of the
   M6/M7 role surfaces early; the full §2.3 walkthrough discipline still applies to what
   ships.
3. **Deferred until after launch:** M8 joint-project two-part RLS (single tenant at launch;
   the schema shape and deny-by-default policies remain in force), M9 campaign calendar,
   M10 client portal, and the remainder of M6/M7/M11 not consumed by Phase L.
4. The accountability-ready schema, the booking state machine, RLS posture, and all
   AGENTS.md rules are unchanged — this ADR re-sequences delivery only. §12's warning that
   the last 20% is the expensive part now applies to L5 before wider promises are made.

## Consequences

Easier: real usage feedback months earlier; the highest-leverage data (real bookings by real
bookers) starts accumulating; admin CRUD stops depending on seed scripts. Harder: launch
carries production duties forward — password flows, backups, support burden, and a
production RLS bar with real staff data before the full adversarial suites of M8/M10 exist
(acceptable: those suites guard *cross-tenant/portal* paths that are not yet exposed).
Locked in: from launch onward, migrations must be backward-safe against live data, and
maestro-prod changes ride the same migration discipline — no dashboard hotfixes.
