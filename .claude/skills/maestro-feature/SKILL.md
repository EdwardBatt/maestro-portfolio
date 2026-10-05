---
name: maestro-feature
description: Create or extend a Maestro frontend feature module. Use when adding any user-facing capability. Enforces the Surface-vs-Engine contract, role scoping, feature-first structure, i18n/RTL, and the role-leakage test.
---

# Building a Maestro feature

Every feature starts from the design doc's Surface vs. Engine contract (§2.3): one engine
line (the complexity the system carries) and one surface line **per role** (what that role
sees). If a role's surface line can't be written in a sentence, the scoping is wrong — stop
and redesign before coding.

## Structure

```
src/features/<feature>/
  api/          # TanStack Query hooks; the only place this feature talks to supabase
  components/   # feature-private components
  hooks/
  types.ts
```

- No cross-feature imports of internals. Shared pieces go to `src/components/` (dumb UI) or
  `src/lib/`. Composition happens in `src/app/`.
- Query keys via a per-feature factory (`bookingKeys.list(filters)`), invalidated narrowly.
- **Presentation only**: no billing math, no SLA rules, no capacity calculations, no
  authorization decisions in the client. Derived values arrive from the server; the client
  displays them. RLS is the access control — the UI merely avoids *offering* what a role
  can't do.

## Role scoping checklist (every feature PR)

1. Which roles see this feature? List them; everyone else must never encounter its controls.
2. Per role: does the surface show anything from another role's toolbox (capacity ceilings
   to a creative, performance data to a booker)? That's role-scope leakage — the §13 failure
   mode. Remove it.
3. Warn-and-allow (§4.1): soft violations inform and offer "proceed"; only DB-enforced hard
   invariants block.
4. Derive, don't ask: every field the system can infer is prefilled or absent, not requested.

## i18n / RTL (non-negotiable, every screen)

- Zero hardcoded user-facing strings — EN + AR keys through the i18n layer from the first
  commit of the screen.
- Layout must mirror correctly in RTL: use logical CSS properties
  (`margin-inline-start`, not `margin-left`); icons/chevrons that imply direction flip.
- Dates/numbers render through locale-aware formatters with an explicit IANA timezone.

## Definition of done

Surface/engine note written (goes in the PR description) · role checklist passed · i18n keys
in both languages · RTL visually checked · Vitest for any non-trivial hook/logic · e2e
walkthrough updated if the role's journey changed (`maestro-e2e`) · matching `docs/TASKS.md`
checkbox(es) ticked in the same change set · accessibility basics (keyboard, labels, focus).
