---
name: maestro-design
description: Visual and interaction design rules for Maestro's UI. Use when building or reshaping any screen, choosing typography/color, designing dashboards or data-dense views, or writing interface copy. Adapted from anthropics/skills frontend-design (Apache-2.0; upstream license retained in this folder), translated to Maestro's brief.
---

# Maestro design language

Maestro is not a marketing page — it is a daily-use professional tool for a creative agency
whose own output is design. The bar is double: it must work like an ops tool and hold up in
front of people who art-direct for a living. The brief, fixed by the design doc:

- **Each role's surface is a small, complete tool** (§2.2) — a creative's screen should feel
  purpose-built for a creative, not "the big app with things hidden." Design each surface to
  its role's vocabulary and rhythm, not to a lowest-common-denominator shell.
- **Calm is the default; attention is earned** (§6.3) — healthy work stays quiet. Amber and
  red are *data*, never decoration: status colors are reserved exclusively for state
  (green/amber/red = on-track/at-risk/breached) and never reused for branding or accents.
  If everything glows, nothing warns.
- **Inform, don't obstruct** (§2.2) — the interaction voice is warn-and-allow: one clear,
  specific consequence ("this puts Sarah at 115%") and a way to proceed. Never stack modal
  confirmations; never block what the database doesn't block.

## Typography & bilingual reality

The single hardest design constraint: **every screen ships in English and Arabic.** Choose
type as a pair from the start — a Latin face and an Arabic companion with matched optical
weight and x-height rhythm (open-license only, per ADR-0002; e.g. the IBM Plex or Noto
families, which ship quality Arabic companions). Numbers in data grids stay tabular-lined in
both locales. Test every type decision in RTL before calling it done: mirrored layout,
correct alignment flips, no clipped ascenders in Arabic script, `margin-inline-*` logical
properties throughout.

Data-dense views (timeline, grids, feeds) get a utility scale: fewer sizes, tighter
tracking, weight for hierarchy rather than size explosions. Display personality lives in the
few low-density moments (empty states, auth, onboarding) — not in the working surfaces.

## Structure is information

Structural devices must encode something true: the exception feed is ranked by urgency, so
its order *is* the message — never decorate it with equal-weight cards. The timeline is the
substrate (§2.2): best-in-class table stakes, executed with precision — alignment, snap
feedback, densities that survive a 200-resource pool — not visual novelty. Spend boldness in
one place per surface and keep everything else disciplined; when in doubt, remove one
element before shipping (the working-tool version of "take one accessory off").

Quality floor on every screen, unannounced: responsive to laptop-small, visible keyboard
focus, `prefers-reduced-motion` respected, WCAG AA contrast in both light contexts, hit
targets ≥40px on touch surfaces (bookers use tablets on set).

## Motion

Motion only where it carries state: a booking chip settling into place after a drag, an
exception entering a feed, a clock pausing. 150–250ms, ease-out, no ambient animation in
working surfaces. If a screen feels dead without decoration, the hierarchy is wrong — fix
that instead.

## Interface copy (EN first, AR as a peer — never an afterthought)

Copy is design material. Name things by what the user controls, in the user's vocabulary,
not the system's: "Blocked on client," not "SLA clock pause state." Active voice; buttons
say exactly what happens ("Confirm booking," not "Submit"); an action keeps one name through
its whole flow. Errors state what happened and what to do next, without apology or vagueness.
Empty states are invitations to act ("No bookings this week — drag on the timeline to
create one"). Every string goes through i18n keys with EN and AR authored together; AR copy
is written, not machine-mirrored, for anything a client sees.

## Process for any new screen

1. Name the role, the screen's single job, and its surface line (§2.3) before sketching.
2. Plan tokens first — color roles, type scale, spacing — from `src/app` theme tokens; no
   per-screen ad-hoc values.
3. Build; screenshot; self-critique against this file; check RTL; remove one thing.
4. If it looks like a generic admin-dashboard template, it fails the double bar — rework
   the hierarchy around the role's actual task order.
