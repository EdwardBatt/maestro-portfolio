---
type: capsule
abstract: The discipline around migrations, and the footguns inside it — read before writing SQL.
status: current
origin: ai-derived
verified: 2026-09-14
sources: [AGENTS.md, docs/adr/0007-*, 0033-*, supabase/migrations/, supabase/tests/, scripts/db/verify.sh, .github/workflows/ci.yml]
---

# Capsule — Changing the database

## The rules that are not negotiable

- **Forward-only.** Never edit an applied migration; fix forward with a new one (ADR-0007).
- **Migrations are files; applying them is Edward's job.** Never run `supabase db push` against a
  remote database. There is no local Supabase stack — development is remote-only.
- **RLS in the same migration as the table.** A table without RLS enabled *and* forced, with policies,
  does not merge. `tenant_id uuid not null references tenants(id)` on every tenant-scoped table, no
  exceptions.
- **Every policy gets pgTAP coverage** — at least one allow and one deny. Joint-project and portal
  paths get the adversarial suite (skill `maestro-rls-testing`).
- **Pin `search_path`** on every `app`/`public` function: `set search_path = public, app, extensions`
  (ADR-0033). `CREATE OR REPLACE` silently drops the pin — see [traps.md](../traps.md).
- **`security definer` needs an ADR.** Prefer invoker: if the function only reads what the caller can
  already select, it needs no elevation.
- **The audit trigger in the same migration as the table** (AGENTS.md §6, 6 Sep). Every table
  carrying `tenant_id` gets `audit_row_change`; pgTAP `092` fails the build naming any that does
  not. Four exemptions only — the two logs themselves and `notifications`/`messages`; a fifth needs
  an ADR. The first attempt was a hand-written array of table names and went a month out of date
  with nothing failing, which is why this is a test and not a habit.

## Naming and shape

`YYYYMMDDHHMMSS_verb_noun.sql`, one concern per file. Tables snake_case plural; timestamps always
`timestamptz`; enums singular (`booking_state`); policies `<table>_<audience>_<action>` where audience
is `tenant` | `joint_project` | `portal` | `service`. Append-only tables get an INSERT policy only,
plus `revoke update, delete`.

Hard invariants belong in Postgres, not application code — the exclusive-overlap ban is an exclusion
constraint, not a check in a function.

## The loop

```bash
# 1. write the migration + its pgTAP suite
bash scripts/db/verify.sh          # fresh throwaway Postgres → all migrations → whole pgTAP suite
# 2. Edward commits, opens a PR — CI runs the same verify.sh
# 3. after merge, Edward:
supabase db push
supabase gen types typescript --project-id <ref> | Out-File -Encoding utf8 src/types/database.ts
npm run typecheck
```

`verify.sh` picks its backend automatically: a native `postgres` superuser on Linux and in CI, or a
throwaway `postgres:16` **Docker** container elsewhere. On Windows without Docker it cannot run at
all — CI is then the first execution, so say so rather than implying the suite passed.

**Both proving grounds are EMPTY when a migration runs** (no tenant on the throwaway; `db reset`
seeds AFTER migrating), so a top-level `update`/`insert` over rows is first exercised on production
— two pushes failed that way on 14 Sep (traps.md). Prove such statements on the local stack inside
`begin; … rollback;`; `I48.31` proposes seeding before the migrations under test. **Regenerate the
types in the same sitting as `db push`** — they lagged 28 migrations on 14 Sep.

**CI runs on `pull_request` as well as pushes to `main`**, so a branch gets the full database job
before merge. Open a PR; do not merge to get CI.

## Migration headers carry the reasoning

This project writes 20–40 line headers explaining what broke, why, what was considered and what was
deliberately not done. Match that. It is the main reason this codebase is navigable, and it is where
future sessions will look first.

## Traps that bite here

`CREATE OR REPLACE` dropping the `search_path` pin · reproducing a seeder from the wrong base and
silently losing grants · plain FKs are not a tenant fence · pgTAP uuids must be hex. All in
[traps.md](../traps.md).

## Known problems

pgTAP may cover only about a third of RLS policies (suspected, unverified). `rates` column protection
(L1.6) appears untested.

## Related

Skills `maestro-migration` and `maestro-rls-testing` encode this. [data-access](data-access.md) for
the type-regeneration lag · [authorization](authorization.md) for what the policies must express.
