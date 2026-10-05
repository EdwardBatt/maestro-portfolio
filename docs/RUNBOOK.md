# Maestro — Production Runbook

Operational procedures for **maestro-prod**. Covers standing up the production
Supabase project, wiring the repo to it, deploying, and go-live checks.

> **Discipline (ADR-0007 lock-in):** from launch onward, migrations are
> backward-safe against live data and **applied only through the CLI** — no
> dashboard hotfixes, no editing an applied migration (fix forward with a new
> one). Git belongs to Edward; agents prepare files and never push.

---

## 1. Stand up `maestro-prod` (dashboard — Edward)

1. Confirm the target **organisation is on the Pro plan** (Organization →
   Billing). Pro is an org-level plan; a project only gets Pro features if it
   lives in a Pro org.
2. **New project** → name `maestro-prod`, region **eu-central-1** (matches
   dev; keep Meridian on one region). Set a strong **database password** and store
   it in the password manager immediately — it is shown once.
3. Wait for provisioning, then collect from the dashboard:
   - **Project ref** (Settings → General) — e.g. `abcd…`
   - **Project URL** and **publishable key** `sb_publishable_…` (Settings → API)
   - **Secret key** `sb_secret_…` (Settings → API) — never committed, never in `.env`

## 2. Link the repo to prod (CLI on Windows — Edward)

```powershell
$env:SUPABASE_DB_PASSWORD = "<prod db password>"      # CLI does not prompt on Windows
supabase link --project-ref <prod-ref>
```

Windows gotchas (from README, hard-won): supply the DB password via the env var
above; if the CLI hangs on "Initialising login role…" or returns odd 403s,
**rule out VPN/proxy first** — that was the root cause before. `db push`
reaching for Docker means the directory isn't linked — re-run `link` from the
repo root.

> Linking rewrites `supabase/.temp/` to the prod ref. To switch back to dev for
> ordinary work, re-run `supabase link --project-ref YOUR-PROJECT-REF`.

## 3. Back up, then apply the schema (Edward)

**Backup first, every time a push carries a data change** (a backfill, a re-emitted function that
rewrites rows). `supabase db dump` borrows `pg_dump` from a Docker container, so **Docker Desktop
must be running** — with it stopped the command fails with *"failed to connect to the docker API"*,
which reads like a local-stack problem and is not: the dump itself comes from the hosted project.

```powershell
supabase db dump --linked -f "<BACKUP_DIR>\backup-schema-YYYY-MM-DD.sql"
supabase db dump --linked --data-only -f "<BACKUP_DIR>\backup-data-YYYY-MM-DD.sql"
```

Then:

```powershell
supabase db push
```

`db push` reads the migration files on disk — the checked-out branch — not `main`. Push from the
branch that holds the migrations, then merge it. After a push that changed a table or column,
regenerate `src/types/database.ts` (`supabase gen types typescript --linked`) before the merge.

Applies every migration in `supabase/migrations/` to prod. Prod starts empty,
so this is a clean first apply. This is the remote-migration step — Edward's to
run, never an agent.

*(Optional pre-check: an agent can run the full migration set + pgTAP against a
throwaway Postgres in the cloud sandbox — `scripts/db/verify.sh` — to confirm a
clean apply before you touch prod. Ask for it.)*

## 4. Regenerate types (Edward or agent)

```powershell
 supabase gen types typescript --linked | Out-File -Encoding utf8 src/types/database.ts
npm run typecheck
```

Prod carries the identical migration set to dev, so the output should be
**byte-identical** to the current `database.ts` — treat any diff as a signal
that dev and prod schemas have drifted. (`Out-File -Encoding utf8`: a plain `>`
redirect writes UTF-16 in PowerShell.)

## 5. Deploy Edge Functions (Edward)

```powershell
supabase functions deploy booking-transition
supabase functions deploy invite-user
supabase functions deploy update-user
```

**Function secrets** — set only the two custom ones. `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into
deployed functions by the platform; do **not** set them by hand.

```powershell
supabase secrets set CRON_SECRET="<random 32+ char string>"
supabase secrets set SITE_URL="<prod frontend URL>"     # placeholder until Vercel exists
```

`SITE_URL` is the base URL invite/recovery links point at. It can wait for the
Vercel domain (§7) — the first admin doesn't need it (§6 uses a temp password).
`CRON_SECRET` gates the `expire_holds` path in `booking-transition`; store it in
the password manager.

### Stalled work — `stall-sweep` (ADR-0045; first rung 22 Sep, SJ-v3-04)

```powershell
supabase functions deploy stall-sweep
```

Cron-invoked on the `archive-sweep` pattern: `POST /functions/v1/stall-sweep` with the
`x-cron-secret: <CRON_SECRET>` header, **hourly**. Every run escalates each opened single job
whose task is still unassigned after the tenant's `assignment_escalation_hours` (default 24, on
the Sunday–Thursday week) to the traffic managers (the `scheduler` role) and the job's owner —
once per job (`deliverables.assignment_escalated_at`). `{ "dryRun": true }` lists the candidates
and sends nothing. The schedule itself is a deploy-time choice (external cron → the function, as
`archive-sweep`); nothing runs until it is set up.

### The Library — `asset-url`, `library-sweep`, `library-archive` (ADR-0134 / ADR-0136, I72)

**Order.** Push `20261002100000` (the Library rules) first. Then run `scripts/db/lookalike-names.sql`
in the SQL editor: `20261002110000` (names that differ only by capitals are taken, ADR-0135)
**refuses to apply while it returns a row**, naming each pair. Close or rename the duplicates, then
push it and `20261002120000` (the archive bookkeeping).

```powershell
supabase functions deploy asset-url          # uploads in parts, thumbnails, preview, copy (ADR-0134)
supabase functions deploy notify-email       # carries the two new notices' words
supabase functions deploy library-sweep
supabase functions deploy library-archive    # deploys switched off — see below
```

**Library uploads in parts — the B2 bucket's CORS rule (Edward, once).** A file is sent in parts
straight to B2, and the browser must read each part's `ETag` from B2's answer to finish the upload.
B2 hides that header unless the bucket's CORS rule exposes it, and the presigned part URLs are S3
URLs, so the rule must allow the S3 operations. In the B2 dashboard → bucket → CORS Rules → custom
(or `b2 bucket update --cors-rules`), the rule for the app's origin(s) needs:

```json
[{
  "corsRuleName": "maestro-app",
  "allowedOrigins": ["https://<prod frontend domain>", "http://localhost:5173"],
  "allowedOperations": ["s3_get", "s3_head", "s3_put", "s3_post"],
  "allowedHeaders": ["*"],
  "exposeHeaders": ["ETag"],
  "maxAgeSeconds": 3600
}]
```

Without `exposeHeaders: ["ETag"]` every upload over the single-part size fails at its last step.
Not verifiable from the repository — check the live rule before the new Library ships. The bucket's
lifecycle rule should also keep "cancel unfinished large files after 1 day" (ADR-0134 d.13);
`library-sweep` does the same from Maestro's side.

**`library-sweep` — daily.** `POST /functions/v1/library-sweep` with `x-cron-secret: <CRON_SECRET>`,
once a day (e.g. 02:00 Baghdad, 23:00 UTC). Each run: tells the adder of every link expiring within
two days (bell + email, once per link); removes from B2 and then from the database every file
deleted more than 30 days ago — **the first code that deletes from storage**, and only objects no
other row names; aborts multipart uploads begun more than 24 hours ago. `{ "dryRun": true }` lists
all three and changes nothing — run it once by hand after deploying and read the answer. Uses the
same B2 secrets as `asset-url`; without them the storage steps say `storage_unconfigured`.

**`library-archive` — switched off (ADR-0136 d.7).** It answers `{ "disabled": true }` and touches
nothing until (1) the office server's address and Maestro's credential exist as secrets and (2) an
adapter for that server's software is written in `supabase/functions/library-archive/transport.ts`
(the one marked place; none exists yet because the service is not known):

```powershell
supabase secrets set OFFICE_ARCHIVE_URL="https://<office server>"   # encrypted in transit only
supabase secrets set OFFICE_ARCHIVE_USER="<Maestro's own account>"
supabase secrets set OFFICE_ARCHIVE_SECRET="<its credential>"
supabase secrets set OFFICE_ARCHIVE_KIND="<webdav | s3 | sftp — whichever the adapter is>"
```

Once on, schedule it daily with `x-cron-secret`. `{ "dryRun": true }` lists, per tenant, what is due
(closed projects past `tenant_storage_settings.archive_after_days`, default 90) even while it is off.
It supersedes **`archive-sweep`**: ADR-0136 d.1 retired that 60-day clock, its due set is now always
empty, and its cron (if one was set up) can be removed.

### Brief ingestion — `ingest-brief` (ADR-0044, provider per ADR-0049)

```powershell
supabase functions deploy ingest-brief
supabase secrets set OPENAI_API_KEY="<key from platform.openai.com/api-keys>"
# optional — model choice is config, not code. Defaults to gpt-5.6-luna.
# Step up to gpt-5.6-terra (~10x the cost) only if extraction quality disappoints.
supabase secrets set OPENAI_MODEL="gpt-5.6-luna"
```

**Before enabling in production, confirm two things on the OpenAI account that owns
the key (ADR-0049 d.6).** Neither is a request parameter and **nothing in the code,
the tests or CI will notice if they are wrong**:

1. **API data is not used for training.** This is OpenAI's default, but an
   organisation can opt out of it — check it has not been.
2. **Zero retention**, if you need it. It is an approved arrangement per project,
   not a toggle. ADR-0044 §6 made it a condition of the residency acceptance, and
   that acceptance was given against *Anthropic's* terms — it does not transfer to
   another company automatically, which is why d.6 re-opens it.

`OPENAI_API_KEY` is a **billable credential** and lives only here and in the
password manager. It is never a `VITE_` variable and never appears in `src/` —
putting it in the browser would hand it to every user (`AGENTS.md` §1).

Until the key is set, the function returns `503 model_unconfigured` and the Brief
Wizard falls back to heading matching and says so, so an unset key degrades the
feature rather than breaking the wizard.

**Zero retention / no training (ADR-0044 §6)** is an *organisation* setting on the
OpenAI account that owns the key — there is no per-request parameter for either.
Set it on the account before the key goes live; Edward's residency acceptance covers
brief text specifically, and it is narrower if the data is also retained.

## 6. Bootstrap the first admin (Edward)

```powershell
$env:SUPABASE_URL = "https://<prod-ref>.supabase.co"          # overrides the dev fallback in the script
$env:SUPABASE_SERVICE_ROLE_KEY = "<prod secret key>"
node scripts/bootstrap-admin.mjs edward@example.test "Edward" "Meridian" meridian
Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
```

Creates the Meridian tenant, seeds the tenant's roles (ADR-0008 `seed_tenant_roles`),
creates the first **Power Admin**, and prints a temp password + reset link. Sign
in with the temp password and change it inside the app.

> **Do NOT run `scripts/seed-dev.mjs` against prod** — that loads Meridian-shaped test
> fixtures. Prod gets real offices/departments/staff via the admin UI (L5.3).
> `bootstrap-admin.mjs` currently falls back to the **dev** URL when
> `SUPABASE_URL` is unset — always set it explicitly for prod (hardening this
> fallback is tracked in L4.4).

## 7. Frontend + Auth URLs (follow-up — L4.2 / L4.3)

Not required to stand up the database, but needed before the team signs in:

1. **Vercel** project from the repo; set env vars `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` to the **prod** values (prod values live in
   Vercel only — never committed, never in local `.env`, which stays on dev).
2. **Auth → URL Configuration** (prod dashboard): Site URL = the Vercel domain;
   add `<domain>/set-password` and the login route to the **redirect
   allowlist** — required for the invite/recovery flow (L1.3).
3. Back-fill `SITE_URL` secret (§5) with the real domain and redeploy functions.

## 8. Go-live checks

- Sign in as the admin on the prod URL → lands on `/admin` with role-scoped nav.
- Anonymous/REST read of a tenant table is denied (RLS smoke).
- Create one real office/department, invite one user end-to-end, confirm the
  set-password email arrives and works.
- Backups / PITR confirmed on the Pro tier (L4.5).

## Rollback

Before real users exist, "rollback" is trivial: the project is empty, so
drop-and-recreate is acceptable. **After** onboarding, migrations are
forward-only against live data — never edit an applied migration; ship a
corrective migration instead. Keep the dev project as the staging ground:
prove every migration on dev, then `db push` to prod.
