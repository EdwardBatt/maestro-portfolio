# Maestro — Agent Rules (Canonical)

This file is the **single source of truth** for project rules and boundaries. `CLAUDE.md` and
`.cursor/rules/maestro.mdc` bind to it. If any instruction conflicts with this file, this file wins.
Changes to these rules require an ADR (`docs/adr/`).

**Context documents, in authority order:**
1. `docs/adr/` — accepted ADRs (highest authority; supersede the design doc)
2. `docs/design/design-draft-v15.md` — frozen design baseline (ADR-0001)
3. `docs/TASKS.md` — build tracker; task IDs are referenced in every commit

---

## 1. Hard boundaries (never violate)

- **No paid dependencies. No copyleft (GPL/AGPL/LGPL) dependencies.** Permissive only
  (MIT/Apache-2.0/BSD/ISC). MPL-2.0 requires an ADR. Check the license *before* installing
  anything. Paid components require explicit written authorization from Edward (ADR-0002).
- **The user owns git.** Agents never commit, push, amend, rebase, or tag unless explicitly
  asked in that session. Agents prepare files; Edward reviews and commits.
- **Never run migrations against a remote/production database.** Migrations are files;
  applying them is Edward's job.
- **Never touch generated files by hand:** `src/types/database.ts` comes only from
  `supabase gen types typescript`.
- **No secrets in code, ever.** No service-role key, storage key, or JWT secret in frontend
  code, committed files, or logs. `.env` is gitignored; only `.env.example` (with empty
  values) is committed.
- **v15 is frozen.** Design changes are recorded as ADRs, never as edits to the design doc.

## 2. Where logic lives (design doc §3.1 — the law)

| Layer | Owns | Never contains |
|---|---|---|
| **Postgres** | Invariants: RLS, exclusion constraints, FKs, enums, generated columns | Business workflows, billing/SLA calculations in triggers |
| **Edge Functions** | Workflows & calculations: booking transitions, approval routing, SLA evaluation, exports | Presentation concerns |
| **Frontend** | Presentation only | Billing math, SLA rules, capacity calculations, authorization decisions |

The client may *display* a derived value; it may never *derive* one that matters. If a number
affects money, deadlines, capacity, or access, it is computed server-side.

**One authorization primitive, one call path (ADR-0037).** Authorization is decided in exactly one
place: `app.has_permission` for the permission axis, `app.in_write_scope` for the scope axis.
Nothing outside the database re-implements either. An Edge Function asks
`hasPermission()` (`supabase/functions/_shared/authz.ts`, over `public.has_permission`) on the
**caller-scoped** client — never a service-role client, which has no `auth.uid()`. No Edge Function,
RPC, or frontend module may decide access by querying `role_grants` / `user_grants` /
`user_scope_grants`; *displaying* a permission matrix is the sole exception, and must compute
effectiveness with the same `(role ∪ allow) − deny` formula. `npm run check:authz` enforces this and
runs in CI — pgTAP cannot execute an Edge Function, so the suite cannot hold this boundary.

Why it is a rule and not a preference: eight functions each kept their own copy of the check, and
when the per-user overlay (ADR-0036) changed the rule, none of the copies moved. Per-user grants
silently did nothing on every multi-step action, and per-user *denials* failed open.

## 3. Repository structure (feature-first)

```
AGENTS.md  CLAUDE.md  .cursor/rules/  .claude/skills/
docs/
  adr/                # ADR log (see docs/adr/README.md)
  design/             # frozen v15 baseline
  TASKS.md            # build tracker
src/
  app/                # shell: routing, providers, role gate, i18n setup
  features/<feature>/ # bookings, resources, capacity, approvals, portal, dashboards…
    api/              # TanStack Query hooks + supabase calls for this feature only
    components/       # feature-private components
    hooks/
    types.ts
  components/         # shared, dumb UI primitives only (no data fetching)
  lib/                # supabase client, i18n, date/tz utils, shared helpers
  types/              # database.ts (generated) + cross-feature types
supabase/
  migrations/         # timestamped forward-only SQL
  functions/<name>/   # one folder per Edge Function
  tests/              # pgTAP suites (RLS adversarial tests live here)
e2e/                  # Playwright suites (role surfaces, portal scoping)
```

Rules: a feature never imports from another feature's internals (`features/x/api` etc.) — shared
code moves to `lib/` or `components/`. Features must be deletable: removing a folder breaks only
that feature. Cross-feature composition happens in `app/`.

## 4. Naming conventions

**Database (snake_case throughout):**
- Tables: plural — `bookings`, `resources`, `sla_events`. Join tables: `resource_skills`.
- Columns: `snake_case`; FKs `<entity>_id`; booleans `is_*`/`has_*`; timestamps `*_at`
  (`timestamptz` **only** — naked `timestamp` is banned).
- Every tenant-scoped table: `id uuid primary key default gen_random_uuid()`,
  `tenant_id uuid not null references tenants(id)`, `created_at`/`updated_at timestamptz`.
- Enums: Postgres enum types, singular — `booking_state`, `capacity_model`.
- Migrations: `YYYYMMDDHHMMSS_verb_noun.sql` — `20260728093000_create_bookings.sql`. One
  concern per migration. Applied migrations are never edited — fix forward.
  The timestamp is a **real** `YYYYMMDDHHMMSS`: `HH` is `00–23`, `MM`/`SS` are `00–59`.
  When spacing migrations, roll the **day** over — never push the hour past `23` (e.g. after
  `…19230000` the next is `…20000000`, not `…19240000`). An invalid hour still sorts and applies,
  but the dashboard can't parse it as a time and shows the raw digits.
- RLS policies: `<table>_<audience>_<action>` — `bookings_tenant_select`,
  `bookings_portal_select`, `bookings_joint_project_select`.
- Indexes: `idx_<table>_<cols>`; constraints: `chk_/uq_/excl_<table>_<meaning>`.

**TypeScript / React:**
- Components: `PascalCase`, file `PascalCase.tsx`, named exports (default exports banned
  except where a framework requires them).
- Hooks: `useX`, file `use-x.ts`. Non-component files: `kebab-case.ts`.
- Variables/functions `camelCase`; types/interfaces `PascalCase` (no `I` prefix);
  constants `SCREAMING_SNAKE_CASE`.
- TanStack Query: per-feature key factory (`bookingKeys.list(filters)`) — no inline string keys.
- Edge Functions: folder `kebab-case` matching the route — `booking-transition`, `finance-export`.

**Git:** Conventional Commits + tracker ID: `feat: booking exclusion constraint [M1.6]`.
Branches: `feat/m1-schema-core`, `fix/…`, `chore/…`.

## 5. Coding principles

- **TypeScript strict.** `strict: true`, `noUncheckedIndexedAccess: true`. `any` is banned
  (`unknown` + narrowing). No `@ts-ignore` without a comment explaining why and a task ID.
- **Validate at every boundary.** Every Edge Function parses its input with Zod before touching
  data. Client input is always hostile.
- **Derive, don't ask** (§2.2): any value the system can infer is never a user-facing input.
- **Default, don't configure:** configuration surfaces are admin-only, one-time.
- **Warn-and-allow** (§4.1): capacity/soft violations inform and let the user proceed; hard
  invariants (double-booked exclusive resource) are enforced by the database, not the UI.
- **i18n from the first screen:** no hardcoded user-facing strings — everything through the
  i18n layer with EN + AR keys; layouts must work in RTL. New screens are reviewed in RTL
  before done.
- **Time is explicit:** all times stored UTC (`timestamptz`); conversions happen at the edge
  with an explicit IANA zone (Baghdad/Dubai/Cairo differ). DST-sensitive logic gets tests.
- **Surface vs. Engine per feature** (§2.3): every feature PR description states the engine
  line and per-role surface lines. If a role's surface can't be written simply, the scoping
  is wrong — redesign, don't ship.
- **No speculative abstraction.** Three concrete uses before a generalization.
- **Accessibility:** interactive elements keyboard-reachable, labelled, focus-visible.

## 6. Security (highest bar — non-negotiable)

- **RLS deny-by-default.** `alter table … enable row level security` + `force row level
  security` in the same migration that creates any table. No policy = no access. A table
  without RLS never merges.
- **Tenant isolation is structural.** `tenant_id` checks come from JWT claims
  (`auth.jwt()`/`auth.uid()` lookups), never from client-supplied parameters. The two-part
  joint-project RLS (own rows + granted project rows, per-field, symmetric) and the client
  portal are the **highest-risk surfaces** (§10.4/§10.2): changes there require adversarial
  pgTAP tests proving cross-tenant/cross-client reads fail, *before* merge.
- **Append-only means append-only.** Audit/SLA-event tables get INSERT policies only — no
  UPDATE/DELETE policy may ever be added; enforce with `revoke update, delete` as well.
- **Everything is logged.** Every table carrying `tenant_id` gets the universal audit trigger
  (`audit_row_change`) **in the migration that creates it** — the same rule, and the same sentence,
  as RLS above. A tenant-scoped table without it never merges: pgTAP `092` names it at build time.
  The four exemptions are the logs themselves (`audit_events`, `sla_events`) and the content that
  already IS the record (`notifications`, `messages`); adding a fifth is an ADR, not a judgement
  call. **This rule exists because the first attempt was a hand-written
  list of 22 tables** (`20260802103000`): correct on the day, wrong from the next table onwards, and
  seventeen tables — every brief, template, concept and asset table built since — were silently
  unaudited for a month with nothing failing.
- **Privileged code paths:** service-role usage only inside Edge Functions/server routes,
  reading keys from environment secrets. Every privileged route authenticates the caller,
  authorizes against the resource, and rate-limits.
- **Media:** private buckets only; signed URLs, short TTL, scoped per deliverable. No public
  buckets, no confidential media on third-party public hosts (§8.3).
- **SECURITY DEFINER** functions require an ADR, a `search_path` pin, and a comment
  explaining why RLS bypass is safe.
- **Errors:** structured envelope; never leak stack traces, SQL, or internal IDs to clients.
  No PII or secrets in logs.
- **Supply chain:** lockfile committed; `npm audit` + license check in CI; new dependencies
  need a reason, a license check, and minimal footprint.
- **Dynamic SQL is banned** in Edge Functions; use parameterized queries/PostgREST.

## 7. Testing bar

- Unit (Vitest): capacity math, date/tz logic, Zod schemas, pure engine helpers.
- Database (pgTAP): every RLS policy has at least one allow and one deny test; joint-project
  and portal paths get the adversarial suite (see `.claude/skills/maestro-rls-testing`).
- E2E (Playwright): per-role surface walkthroughs from the §2.3 surface lines; portal scoping
  probes; RTL smoke pass (see `.claude/skills/maestro-e2e`).
- **Every interactive control has a browser test that presses it, as one person who may and one
  who may not; a refusal is worded and never reportable** (ADR-0095). `npm run check:e2e-coverage`
  fails CI on a control no spec presses that is not in `e2e/coverage-baseline.json` with its reason.
- A task in `docs/TASKS.md` is checked only when its tests exist and pass.

## 8. Decision discipline

- Any resolution of an Open Decision (design doc §11), stack change, schema-shape choice, or
  rule change ⇒ ADR first (`.claude/skills/maestro-adr`), referencing OD and task IDs.
- Never silently diverge from the design doc or this file: propose an ADR and wait.
- After completing work, update the matching checkbox(es) in `docs/TASKS.md` in the same
  change set.
- **Every new task goes into `docs/TASKS.md` — always, and at the moment it is identified**
  (Edward, 7 Sep). A defect found while doing something else, a follow-up a review throws up, work
  deferred to "next session": it gets an ID before it gets worked on, not after. Notes in
  `docs/memory/` do not count and never have — memory records orientation, the tracker records
  work, and four multi-day scheduling defects sat in memory alone for a day with nothing to
  schedule, reference in a commit, or tick (now `I41`).

## 9. Shared project memory (`docs/memory/`)

One memory, read and written by every AI tool on this repository — Claude Code, Claude Cowork,
Cursor, Antigravity, Gemini. There is no per-agent memory, and no agent may create one.

This system is called **Compass**. The folder is named `memory` for historical reasons only; a
portable copy, with both commands and the lint, is in `docs/reference/compass/` for use in other
repositories.

**At the start of a task**, read in order and stop as soon as you have enough:
`docs/memory/README.md` → `docs/memory/MAP.md` → the **one** capsule the map names → the source
files it points at. Every capsule declares a one-sentence `abstract:` and `MAP.md` carries a copy of
it in the routing row, so **which** capsule is decided from the map without opening one (ADR-0064). Add `docs/memory/STATE.md` when the task depends on what is already built, and
`docs/memory/traps.md` before debugging something that should work. **Never load the whole vault.**

**Authority.** Memory sits *below* everything in the context list at the top of this file:

1. current source code, migrations, live schema, running config — always wins
2. accepted ADRs (`docs/adr/`) 3. this file 4. `docs/TASKS.md`
5. `docs/memory/` capsules, state, traps 6. `docs/memory/sessions/`

If a note and the code disagree, **the code is right**: fix the note in the same session and set its
`verified:` date. Never leave both readings standing.

**Writing back.** A costly discovery goes in `traps.md`; a change in what is built goes in
`STATE.md`; durable orientation goes in the relevant capsule. Update in place — a new file needs a
reason. **A decision never goes in memory; it becomes an ADR.** Session notes are written only when
Edward asks. Mark inference `(inferred)`; where a reason cannot be established write "Reason unknown
— inferred from implementation" rather than inventing one. Never rewrite an `origin: human` line.

Health check: `node scripts/memory-lint.mjs`.
