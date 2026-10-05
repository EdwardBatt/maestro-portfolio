# Maestro

**Resource & Traffic Management Platform**

A system to enforce discipline and accountability — built on resource-first scheduling, with SLAs,
time tracking, approval workflows, and a finance export to Odoo. Designed for multi-office creative
and marketing agencies (EN/AR bilingual, RTL-aware), multi-tenant from day one.

> **Public portfolio copy.** This is a sanitized snapshot of a private codebase, published for
> evaluation only (see `LICENSE`). Client, staff and production details have been replaced with
> fictional ones: "Meridian" is the fictional agency tenant, and its clients, brands and people are
> invented.

**Design source of truth:** [`docs/design/design-draft-v15.md`](docs/design/design-draft-v15.md)
**Build tracker:** [`docs/TASKS.md`](docs/TASKS.md)
**Decision log:** [`docs/adr/`](docs/adr/) (Open Decisions mirrored in the tracker's OD Gate table)

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript (Vite) |
| Server state / grids | TanStack Query + TanStack Table |
| Scheduler UI | Permissive OSS resource timeline — spike in progress (task 0.1.6: dnd-timeline / vis-timeline / react-calendar-timeline); no paid or copyleft deps |
| Backend / data | Supabase — Postgres, Auth, RLS, Realtime, Storage |
| Schema | SQL-first migrations via Supabase CLI (no ORM) |
| Business logic | Edge Functions (Deno/TS) |
| Heavy media | Backblaze B2 / Cloudflare R2 behind CDN, signed URLs |
| Deck editing | Collabora Online (WOPI) — Full v1 |
| Huddles | LiveKit self-hosted — Full v1 |
| Finance | Daily period-locked export → Odoo (no billing engine) |

## Where logic lives (§3.1 — the discipline)

1. **Database** — invariants only: RLS, exclusion constraints, referential integrity.
2. **Edge Functions** — workflows & calculations: approval routing, SLA evaluation, exports.
3. **Frontend** — presentation only. No billing math, no SLA rules, ever.

## Getting started (remote-only — no local Supabase, no Docker)

```bash
npm ci
cp .env.example .env        # fill in the Supabase URL + publishable key
npm run dev
```

Database workflow targets the **hosted** project exclusively:

```bash
supabase link --project-ref <ref>       # once per machine (see note below)
supabase db push                        # apply migrations in supabase/migrations/
supabase gen types typescript --linked | Out-File -Encoding utf8 src/types/database.ts   # plain > writes UTF-16 in PowerShell
npm run typecheck
```

Migration correctness is verified without any local stack: `scripts/db/verify.sh`
runs migrations + the pgTAP suite against a throwaway plain Postgres (also in CI).

**Windows CLI notes (hard-won):** recent CLI versions do NOT prompt for the
database password on Windows — supply it via `$env:SUPABASE_DB_PASSWORD` when
linking (stored in Windows Credential Manager afterwards). If CLI commands hang
("Initialising login role…") or return odd 403s, **rule out VPN/proxy
interference first** — it was the root cause here. `db push` reaching for
Docker (`npipe:...dockerDesktopLinuxEngine` errors) means the directory isn't
linked — re-run `supabase link` from the repo root.

## Repo conventions

- Task IDs from `docs/TASKS.md` go in commit messages: `feat: booking exclusion constraint [M1.6]`
- Every Open Decision resolution gets an ADR in `docs/adr/`
- No copyleft (GPL/AGPL) source or dependencies — design references only (design doc §9)
- Every table carries `tenant_id` + RLS from its first migration — no retrofits

## License

Proprietary — all rights reserved. Not open source. See `LICENSE`.
