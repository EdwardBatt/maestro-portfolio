---
type: trap
status: current
origin: ai-derived
verified: 2026-10-04
sources: [supabase/migrations/, src/lib/, src/app/permissions.tsx, src/features/deliverables/DeliverablesPage.tsx, src/features/schedule/components/BookingDialog.tsx, e2e/local/, session work 24 Aug - 1 Oct 2026]
---

# Traps

Non-obvious failure modes that have actually cost time on this project. Each one is here because
something broke, not because it might. **Read this before debugging anything that "should work".**

Add a row when a bug takes more than a few minutes to understand and the cause was not visible from
the symptom. Do not add general advice.

---

## Index — read this, then only the entries you need

**This file is 87 entries and around 24,200 tokens.** Reading it whole to answer one question is the
single most expensive thing in this store, and it grows every time something bites. So it carries its
own map: scan the lines below, open the two or three that could be your symptom, and skip the rest.

The wording is the SYMPTOM, not the cause — you are matching against what you are looking at, not
against what turns out to be wrong. That is the whole point of the file.

**Database / PostgREST**
- [An embed silently returns nothing when the FK is ambiguous](#an-embed-silently-returns-nothing-when-the-fk-is-ambiguous)
- [A migration that only ADDED columns makes a page lose data it never touched](#a-migration-that-only-added-columns-makes-a-page-lose-data-it-never-touched)
- [`npm run typecheck` says nothing at all about `supabase/functions/`](#npm-run-typecheck-says-nothing-at-all-about-supabasefunctions)
- [PostgREST exposes `public` only, so `rpc('some_app_helper')` fails at runtime](#postgrest-exposes-public-only-so-rpcsome_app_helper-fails-at-runtime)
- [A pgTAP file you only reworded stops with `syntax error at or near "select"` and `Bad plan`](#a-pgtap-file-you-only-reworded-stops-with-syntax-error-at-or-near-select-and-bad-plan)
- [`rpc()` is a POST, and so is every Edge Function call](#rpc-is-a-post-and-so-is-every-edge-function-call)
- [`CREATE OR REPLACE FUNCTION` silently drops the `search_path` pin](#create-or-replace-function-silently-drops-the-search_path-pin)
- [Reproducing a function from the wrong base silently drops whatever came after](#reproducing-a-function-from-the-wrong-base-silently-drops-whatever-came-after)
- [A guard that cannot find its anchor passes silently instead of failing](#a-guard-that-cannot-find-its-anchor-passes-silently-instead-of-failing)
- [A plain `references resources(id)` is not a tenant fence](#a-plain-references-resourcesid-is-not-a-tenant-fence)
- [`ON CONFLICT`'s target is an expression context, so an OUT parameter shadows a column](#on-conflicts-target-is-an-expression-context-so-an-out-parameter-shadows-a-column)
- [A migration's own trigger refuses the migration's data fix](#a-migrations-own-trigger-refuses-the-migrations-data-fix)
- [A pgTAP suite cannot prove a lock, and cannot express a race at all](#a-pgtap-suite-cannot-prove-a-lock-and-cannot-express-a-race-at-all)
- [An RPC parameter with a non-null default can never be "not supplied"](#an-rpc-parameter-with-a-non-null-default-can-never-be-not-supplied)
- [A page says "Could not load" for one busy person and nobody else](#a-page-says-could-not-load-for-one-busy-person-and-nobody-else)
- [A session reports "typecheck clean" and CI fails on the first push](#a-session-reports-typecheck-clean-and-ci-fails-on-the-first-push)
- [A campaign has no brief type, so nothing at wizard time knows which brief is in play](#a-campaign-has-no-brief-type-so-nothing-at-wizard-time-knows-which-brief-is-in-play)
- [Renumbering `sort_order` in place collides with itself mid-statement](#renumbering-sort_order-in-place-collides-with-itself-mid-statement)
- [A user added AFTER `helpers/seed.sql` has no JWT, and the failure says "not found"](#a-user-added-after-helpersseedsql-has-no-jwt-and-the-failure-says-not-found)
- [A uuid you invented is rejected as invalid input syntax](#a-uuid-you-invented-is-rejected-as-invalid-input-syntax)
- [Sign-in fails with `500 Database error querying schema` on a database you just seeded](#sign-in-fails-with-500-database-error-querying-schema-on-a-database-you-just-seeded)
- [`42501 permission denied for table …` on a fresh database, with RLS never consulted](#42501-permission-denied-for-table--on-a-fresh-database-with-rls-never-consulted)
- [A pgTAP assertion about `notifications` finds nothing, or finds nothing and passes](#a-pgtap-assertion-about-notifications-finds-nothing-or-finds-nothing-and-passes)
- [Two migrations built in parallel each "reproduce" the same constraint, and the second wins](#two-migrations-built-in-parallel-each-reproduce-the-same-constraint-and-the-second-wins)
- [An RPC refuses correctly, and a bare PATCH on the same column succeeds](#an-rpc-refuses-correctly-and-a-bare-patch-on-the-same-column-succeeds)
- [Two rows written in one transaction share `created_at`, and "the latest" is either of them](#two-rows-written-in-one-transaction-share-created_at-and-the-latest-is-either-of-them)
- [A PostgREST embed named by column returns 400 PGRST200 "could not find a relationship"](#a-postgrest-embed-named-by-column-returns-400-pgrst200-could-not-find-a-relationship)
- [Every AI or email flow dead-ends locally — the receipt read, the brief fill, notifications](#every-ai-or-email-flow-dead-ends-locally--the-receipt-read-the-brief-fill-notifications)
- [`supabase db reset` fails in the SEED and a fresh local database comes up empty](#supabase-db-reset-fails-in-the-seed-and-a-fresh-local-database-comes-up-empty)
- [Every `throws_ok` in a new pgTAP file reports "caught: no exception", and the trigger is provably right](#every-throws_ok-in-a-new-pgtap-file-reports-caught-no-exception-and-the-trigger-is-provably-right)
- [After `supabase db reset`, reads work but every write returns 403 / permission denied](#after-supabase-db-reset-reads-work-but-every-write-returns-403--permission-denied)
- [`create or replace view` fails with "cannot change name of view column"](#create-or-replace-view-fails-with-cannot-change-name-of-view-column)
- [`db push` fails on production on a migration that `verify.sh` and the Docker reset both passed](#db-push-fails-on-production-on-a-migration-that-verifysh-and-the-docker-reset-both-passed)
- [`supabase db dump --linked` fails with "failed to connect to the docker API" — it looks local, it is not](#supabase-db-dump---linked-fails-with-failed-to-connect-to-the-docker-api--it-looks-local-it-is-not)
**Authorization**
- [Holding the permission is not the same as being in scope](#holding-the-permission-is-not-the-same-as-being-in-scope)
- [A null argument to `in_write_scope` silently kills a whole class of approver](#a-null-argument-to-in_write_scope-silently-kills-a-whole-class-of-approver)
- [A person who can create the parent row is refused writing its child, and the policies "match"](#a-person-who-can-create-the-parent-row-is-refused-writing-its-child-and-the-policies-match)
- [Permissions are fail-closed, so "not loaded" looks exactly like "refused"](#permissions-are-fail-closed-so-not-loaded-looks-exactly-like-refused)
- [A human resource can never trip the exclusive-overlap constraint](#a-human-resource-can-never-trip-the-exclusive-overlap-constraint)
- [A picker offers work the gate then refuses — the screen and the trigger answer the same question from two places](#a-picker-offers-work-the-gate-then-refuses--the-screen-and-the-trigger-answer-the-same-question-from-two-places)
**Frontend**
- [A deadline is a DAY stored as a MOMENT, and the screens are right only by accident](#a-deadline-is-a-day-stored-as-a-moment-and-the-screens-are-right-only-by-accident)
- [`src/types/database.ts` lags one migration behind](#srctypesdatabasets-lags-one-migration-behind)
- [A test that reads a source FILE fails after an edit that `git diff` shows as clean](#a-test-that-reads-a-source-file-fails-after-an-edit-that-git-diff-shows-as-clean)
- [The Figma page is too large to read, and a screenshot per screen burns the context](#the-figma-page-is-too-large-to-read-and-a-screenshot-per-screen-burns-the-context)
- [A new `api/` module makes unrelated suites fail in CI but pass on your laptop](#a-new-api-module-makes-unrelated-suites-fail-in-ci-but-pass-on-your-laptop)
- [A permissively-licensed package can still fail `check:licenses` on its dependencies](#a-permissively-licensed-package-can-still-fail-checklicenses-on-its-dependencies)
- [An Edge Function's logic can be unit-tested — put it in a `handler.ts`](#an-edge-functions-logic-can-be-unit-tested--put-it-in-a-handlerts)
- [A slow await + `setState(value)` silently reverts everything typed meanwhile](#a-slow-await--setstatevalue-silently-reverts-everything-typed-meanwhile)
- [i18next plural keys are `_one` / `_other`, and Arabic's full set breaks the parity test](#i18next-plural-keys-are-_one--_other-and-arabics-full-set-breaks-the-parity-test)
- [Work that is finished, cancelled or called off will not leave somebody's My Work](#work-that-is-finished-cancelled-or-called-off-will-not-leave-somebodys-my-work)
- [Two screens disagree about the same task's reviewers, dates or flags](#two-screens-disagree-about-the-same-tasks-reviewers-dates-or-flags)
- [The campaign wizard has no step reviewing tasks, and the tasks do not exist yet either](#the-campaign-wizard-has-no-step-reviewing-tasks-and-the-tasks-do-not-exist-yet-either)
- [A `grep … | grep -v test` count of buttons, links or props is far too low](#a-grep--grep--v-test-count-of-buttons-links-or-props-is-far-too-low)
- [A button does nothing at all — no error, no navigation, and the handler looks right](#a-button-does-nothing-at-all--no-error-no-navigation-and-the-handler-looks-right)
- [A page scrolls sideways on a phone though its wide table sits in its own scrolling box](#a-page-scrolls-sideways-on-a-phone-though-its-wide-table-sits-in-its-own-scrolling-box)
- ["The AI stopped proposing" — and the function's logs and the OpenAI dashboard show no calls today](#the-ai-stopped-proposing--and-the-functions-logs-and-the-openai-dashboard-show-no-calls-today)
- [A person picker offers the wrong kind of people (team leads in the account manager box)](#a-person-picker-offers-the-wrong-kind-of-people-team-leads-in-the-account-manager-box)
- [The Figma desktop tool keeps returning the same section, whatever Edward selects or deselects](#the-figma-desktop-tool-keeps-returning-the-same-section-whatever-edward-selects-or-deselects)
- [A SQL script's first result never shows in the Supabase SQL editor — only the last query's table appears](#a-sql-scripts-first-result-never-shows-in-the-supabase-sql-editor--only-the-last-querys-table-appears)
- [Deleting a project fails with chk_brief_receipt_confirmed_is_complete on campaign_brief_receipts](#deleting-a-project-fails-with-chk_brief_receipt_confirmed_is_complete-on-campaign_brief_receipts)
**A mutation that provisions rows must invalidate what it provisioned**
- [A dialog that RE-DERIVES a value on open will write it back on save](#a-dialog-that-re-derives-a-value-on-open-will-write-it-back-on-save)
- [An Edge Function 401 while the database call in the same click succeeds](#an-edge-function-401-while-the-database-call-in-the-same-click-succeeds)
- [`vitest run` on one suite prints nothing and never returns](#vitest-run-on-one-suite-prints-nothing-and-never-returns)
- [CI fails on the step AFTER the one you just fixed, on tests that pass locally](#ci-fails-on-the-step-after-the-one-you-just-fixed-on-tests-that-pass-locally)
- [One vitest test fails in the full run and passes every other way](#one-vitest-test-fails-in-the-full-run-and-passes-every-other-way)
**Browser tests (Playwright, local stack)**
- [A spec passes alone and fails in the full run, or `locator.click: Test ended` on a Save button](#a-spec-passes-alone-and-fails-in-the-full-run-or-locatorclick-test-ended-on-a-save-button)
- [After `supabase db reset` every page says "Couldn't load your permissions", for every persona](#after-supabase-db-reset-every-page-says-couldnt-load-your-permissions-for-every-persona)
- [A full run wrote 123 notifications and Mailpit holds 13 — the slow lane looks broken](#a-full-run-wrote-123-notifications-and-mailpit-holds-13--the-slow-lane-looks-broken)
- [A Node script driving the app opens `http://localhost:5173C:/Program Files/Git/…`, or a `fullPage` screenshot shows one screen](#a-node-script-driving-the-app-opens-httplocalhost5173cprogram-filesgit-or-a-fullpage-screenshot-shows-one-screen)
- [A booking "could not be made" but the task IS assigned — and every Edge Function answers 503 "name resolution failed"](#a-booking-could-not-be-made-but-the-task-is-assigned--and-every-edge-function-answers-503-name-resolution-failed)
- [A list on production never updates — "users are submitting for review without pressing Start", or a second tab keeps an old count for ever](#a-list-on-production-never-updates--users-are-submitting-for-review-without-pressing-start-or-a-second-tab-keeps-an-old-count-for-ever)
- ["This was working yesterday" — a change on the client stopped reaching its campaigns, and no code changed on that path](#this-was-working-yesterday--a-change-on-the-client-stopped-reaching-its-campaigns-and-no-code-changed-on-that-path)
- [A new table answers `permission denied` on the local stack though its RLS and pgTAP are fine](#a-new-table-answers-permission-denied-on-the-local-stack-though-its-rls-and-pgtap-are-fine)
- [A coverage spec fails on mail or the model mid-session, and the function log says "File change detected"](#a-coverage-spec-fails-on-mail-or-the-model-mid-session-and-the-function-log-says-file-change-detected)
- [A Playwright test runs for its whole 15-minute timeout on a line that should have failed at once](#a-playwright-test-runs-for-its-whole-15-minute-timeout-on-a-line-that-should-have-failed-at-once)
- [An `after update of <column>` trigger never runs, though the column visibly changed](#an-after-update-of-column-trigger-never-runs-though-the-column-visibly-changed)
- [A migration re-emitted from `pg_get_functiondef` fails at `$function$`, or its every line is doubled with blank ones](#a-migration-re-emitted-from-pg_get_functiondef-fails-at-function-or-its-every-line-is-doubled-with-blank-ones)
- [`supabase db push` sits there for ever and the database shows nothing blocked](#supabase-db-push-sits-there-for-ever-and-the-database-shows-nothing-blocked)
- [`supabase migration up --local` refuses to run anything after you switch branches](#supabase-migration-up---local-refuses-to-run-anything-after-you-switch-branches)
- [A new table has its tenant tag, RLS and audit trigger, and pgTAP 123 still fails it](#a-new-table-has-its-tenant-tag-rls-and-audit-trigger-and-pgtap-123-still-fails-it)
- [Every spec times out on a page that loads fine by hand, and the screenshot is somebody else's app](#every-spec-times-out-on-a-page-that-loads-fine-by-hand-and-the-screenshot-is-somebody-elses-app)
- [A walk passes end to end and never reached the end](#a-walk-passes-end-to-end-and-never-reached-the-end)
- [A walk's RPC checks all fail `401 JWT expired` while its screens work](#a-walks-rpc-checks-all-fail-401-jwt-expired-while-its-screens-work)
- [A mail check counts mail to people the step never touched](#a-mail-check-counts-mail-to-people-the-step-never-touched)
- [English specs fail on words after a walk — the pages come up in Arabic](#english-specs-fail-on-words-after-a-walk--the-pages-come-up-in-arabic)
- [`check:e2e-coverage` says a control is covered, and no spec ever pressed it](#check-e2e-coverage-says-a-control-is-covered-and-no-spec-ever-pressed-it)
- [A list quietly ends — the newest items are missing and nothing errors](#a-list-quietly-ends--the-newest-items-are-missing-and-nothing-errors)
- [A helper's worktree has none of the branch's recent work](#a-helpers-worktree-has-none-of-the-branchs-recent-work)
- [Specs pass on the long-lived local database and fail after a reset](#specs-pass-on-the-long-lived-local-database-and-fail-after-a-reset)
- ["More" loads nothing though there are more rows](#more-loads-nothing-though-there-are-more-rows)
- [Every single-job release is refused: "InheritedRules still says '[]'"](#every-single-job-release-is-refused-inheritedrules-still-says-)
- [The whole tracker shows as changed after a one-line edit](#the-whole-tracker-shows-as-changed-after-a-one-line-edit)
- [`supabase db push` would stop on a NOT NULL that passed every local check](#the-release-push-would-stop-on-a-not-null-that-passed-every-local-check)
- [`db push` says local migrations must be "inserted before the last migration on remote"](#db-push-says-local-migrations-must-be-inserted-before-the-last-migration-on-remote)
- [A walk's "every mail has its notification" check fails with the notification right there](#a-walks-every-mail-has-its-notification-check-fails-with-the-notification-right-there)
- [A walk's set-up fails on a second run: "A campaign with this name already exists"](#a-walks-set-up-fails-on-a-second-run-a-campaign-with-this-name-already-exists)
- [A step fails with a 15-second timeout on a dialog it never waited for](#a-step-fails-with-a-15-second-timeout-on-a-dialog-it-never-waited-for)
- [A save's success message says the opposite of what was just done](#a-saves-success-message-says-the-opposite-of-what-was-just-done)
- [A lead booking a new task for someone in another department is refused as a team lead](#a-lead-booking-a-new-task-for-someone-in-another-department-is-refused-as-a-team-lead)
- [A new permission fails on permission_catalog_action_check, or its test grant on granted_by](#a-new-permission-fails-on-permission_catalog_action_check-or-its-test-grant-on-granted_by)
- [The dev server serves a blank page after a branch switch — requests 504 "Outdated Optimize Dep"](#the-dev-server-serves-a-blank-page-after-a-branch-switch--requests-504-outdated-optimize-dep)
- [Dev "View as" a role shows every personal page empty, and Needs you never loads](#dev-view-as-a-role-shows-every-personal-page-empty-and-needs-you-never-loads)
- [A pgTAP fixture made "after the cut-over" behaves as if made before it](#a-pgtap-fixture-made-after-the-cut-over-behaves-as-if-made-before-it)
- [A function reading `auth.users.raw_app_meta_data` works locally and fails in `verify.sh` / CI](#a-function-reading-authusersraw_app_meta_data-works-locally-and-fails-in-verifysh--ci)
- [`supabase db push` printed none of the migration's `raise notice` lines](#supabase-db-push-printed-none-of-the-migrations-raise-notice-lines)
- [A spec passes on a copy of an older commit and fails on the branch, the click landing on a dialog's grey backdrop](#a-spec-passes-on-a-copy-of-an-older-commit-and-fails-on-the-branch-the-click-landing-on-a-dialogs-grey-backdrop)
- [Browser specs fail on names after the demo scripts ran — "Dev Account Mgr 2" reads "Rasha El-Sayed"](#browser-specs-fail-on-names-after-the-demo-scripts-ran--dev-account-mgr-2-reads-rania-el-masri)
- [A spec fails on some weekdays and passes on others, with nothing changed](#a-spec-fails-on-some-weekdays-and-passes-on-others-with-nothing-changed)
- [One role lacks a permission every similar role has, and no migration ever removed it](#one-role-lacks-a-permission-every-similar-role-has-and-no-migration-ever-removed-it)
- [Typing a date by hand crashes the whole page — "Unexpected Application Error! Invalid time value"](#typing-a-date-by-hand-crashes-the-whole-page--unexpected-application-error-invalid-time-value)
- [A browser test fails with "Couldn't load your permissions" right after you edited a file, and passes on the rerun](#a-browser-test-fails-with-couldnt-load-your-permissions-right-after-you-edited-a-file-and-passes-on-the-rerun)
- [An escalation pgTAP file fails locally with counts in the dozens ("have: 65"), and passes in `verify.sh`](#an-escalation-pgtap-file-fails-locally-with-counts-in-the-dozens-have-65-and-passes-in-verifysh)
- [`supabase db query --linked` answers 400 "Too small: expected string to have >=1 characters"](#supabase-db-query---linked-answers-400-too-small-expected-string-to-have-1-characters)
- [The page crashes with "ReferenceError: X is not defined" while `tsc -b` is clean](#the-page-crashes-with-referenceerror-x-is-not-defined-while-tsc--b-is-clean)
- [Dozens of files show as modified in `git status`, and `git diff` on each is empty](#dozens-of-files-show-as-modified-in-git-status-and-git-diff-on-each-is-empty)
- [Every signed-in test user gets "Couldn't load your permissions" after a database reset, on every rerun](#every-signed-in-test-user-gets-couldnt-load-your-permissions-after-a-database-reset-on-every-rerun)
- [Every Library upload fails locally — "It did not upload. Try again." — and asset-url answers storage_unconfigured](#every-library-upload-fails-locally--it-did-not-upload-try-again--and-asset-url-answers-storage_unconfigured)
- [`supabase db push` stops with "deadlock detected (40P01)" on a migration that ran clean everywhere else](#supabase-db-push-stops-with-deadlock-detected-40p01-on-a-migration-that-ran-clean-everywhere-else)
- [A walk hangs for the whole test timeout on one click, then "worker process exited unexpectedly (code=143)"](#a-walk-hangs-for-the-whole-test-timeout-on-one-click-then-worker-process-exited-unexpectedly-code143)

---

## Database / PostgREST

### An embed silently returns nothing when the FK is ambiguous

`sub_tasks` → `user_profiles` has **five** foreign keys (`assignee_id`, `created_by`, `updated_by`,
`assigned_by`, `approved_by` — `reviewer_id` was dropped by ADR-0043). PostgREST refuses an embed it
cannot disambiguate, and the result comes back **empty rather than as an error**, so it reads like
"no data" instead of "bad query". `media_records` → `user_profiles` has the same problem with two.

Name the constraint: `assignee:user_profiles!sub_tasks_assignee_id_fkey(display_name)`. Composite
FKs (`sub_task_resources`, `sub_task_reviewers`) need it too —
`user_profiles!fk_sub_task_reviewers_user(display_name)` — and a *nested* embed PostgREST cannot
resolve fails the same silent way, so prefer a flat second query.

*Cost: debugged twice, on separate days (I11.3, I12.16).*

### A migration that only ADDED columns makes a page lose data it never touched

**Symptom (16 Sep, I51.1):** after `created_by` / `updated_by` were added to every tenant table,
releasing a single job produced a deliverable with NO owner and no department, and the owner's
"Approve task list" never appeared. The release code was untouched; the migration had not named
`owner_user_id` anywhere.

**Cause:** the first cut gave the new columns a `references user_profiles(id)`. A foreign key is
what a PostgREST embed rides on — and two more from every table to `user_profiles` turned every
existing UNNAMED embed to it (`clients(account_manager:user_profiles(display_name))`,
`campaign_briefs(approver:user_profiles(…))`, the wizard's lead lookup, dozens more) into an
ambiguous one. Ambiguous embeds come back EMPTY, not as an error (the entry above), so the wizard
read "no leads", sent `ownerUserId: null`, and the release went through ownerless.

**Rule:** a column that points at `user_profiles` from a table the client embeds through gets NO
foreign key unless every existing embed on that table is checked and named first. The actor columns
carry none; names are read by id (`src/lib/users/user-names.ts`). Profiles are deactivated, never
deleted, so nothing dangles. When a migration must add such a key, grep `user_profiles(` in `src/`
for that table before pushing.

*Cost: a coverage spec red for an hour, three theories (schema cache, stale auth, the computed
column) before the release helper's own owner read was tried by hand.*

### `npm run typecheck` says nothing at all about `supabase/functions/`

`tsconfig.app.json` includes `src` and `tsconfig.node.json` includes `vite.config.ts`. Nothing
includes `supabase/functions/`, and nothing can: they are Deno, with `npm:` and `esm.sh` specifiers
tsc cannot resolve. **`deno check` in CI is the only thing that type-checks an Edge Function**, so a
type error there survives a green `typecheck`, a green `npm test` and a green lint, and first
appears on a push.

Run the CI command itself before pushing anything under `supabase/functions/` — Deno needs no
install:

```bash
npx --yes deno@2 check supabase/functions/_shared/*.ts supabase/functions/*/index.ts
rm -f deno.lock   # written as a side effect; the repo has no lockfile by decision (see §13 watch-item)
```

Roughly 30 seconds cold, and it is the same invocation `.github/workflows` runs.

*Cost: a red CI run on `propose-concepts` (I34.2, 2 Sep) — a PostgREST builder typed as a plain
object, so `await`ing a chain that ended without `single()` returned the builder and reading `.data`
off it was an error nothing local could see. The vitest suite imports the same file and passes,
because vitest transpiles without checking types.*

### PostgREST exposes `public` only, so `rpc('some_app_helper')` fails at runtime

`app.current_tenant_id()` exists, is used by every RLS policy, and is **not callable from a
client**: PostgREST serves the `public` schema, so `caller.rpc('current_tenant_id', {})` resolves to
nothing. `propose-concepts` shipped with exactly that call, took `tenant_id: undefined` into its
insert, and 502'd **every press of the button in production** (I34.2, 2 Sep).

**Why the symptom misleads:** the failure surfaces as the function's own generic "could not be
proposed" 502, which reads as the model being down. The RPC does not throw — it returns an error
object that a `.data` read quietly turns into `undefined`, so the first wrong value appears three
statements later, in a table the caller does have permission to write.

Before calling `rpc(name)` from a function or the browser, confirm there is a
`create ... function public.<name>` — `grep -rn "function public.<name>" supabase/migrations/`.
The `app` schema is for SQL, not for callers. Where the value is already in a row you have read
under RLS, take it from there instead of asking for it: that is both correct and one fewer call.

*Cost: a production outage between deploy and the next commit, and a diagnosis that started at the
model. The unit tests all passed — they covered 401/403/400/405 and never once exercised a
successful call, which is the more useful lesson: a request path tested only for its refusals is
untested.*

### `rpc()` is a POST, and so is every Edge Function call

PostgREST tunnels every `rpc()` through POST; Edge Functions are POST-only. Anything that decides
"POST means write" also blocks reads. This shipped: the dev preview guard blocked
`public.my_scope_grants()`, the permission fetch failed, `defaultRoute` fell back to its `'/login'`
string, and signed-in users were sent to the login form.

If you need to tell reads from writes at the HTTP layer, classify by **what is being called**, not
the verb. See `src/lib/preview-guard.ts`.

*Cost: users reported being logged out mid-session (I12.17).*

### `CREATE OR REPLACE FUNCTION` silently drops the `search_path` pin

Replacing a function resets its `proconfig`. ADR-0033 requires
`set search_path = public, app, extensions` on every `app`/`public` function; reproduce a function
without that clause and the pin is gone with no error and no test failure — only the Supabase
security advisor notices, later.

Every `create or replace function` carries the `SET` clause. No exceptions.

### Reproducing a function from the wrong base silently drops whatever came after

`app.seed_tenant_roles` is reproduced wholesale by many migrations. On 24 Aug one was rebuilt from an
older copy and lost `('account_manager','manage')` — no error, no failing test; new tenants simply
got an Account Manager who could never be assigned to a client. Found by diffing, not by testing.

It is not just seeders. On 26 Aug `app.tg_booking_notify_resource` was rebuilt from `20260819110000`,
the migration that CREATED it — but `20260819120000` had since added
`if v_label is null then return new`, the line that keeps a plain resource reservation silent.
Rebuilding from the older copy dropped it and every plain reservation started notifying. pgTAP `025`
caught it, four assertions failing at once, each off by exactly one.

**Before any `create or replace function`, grep for every migration that defines it and reproduce
from the LAST one.** `grep -rln "<function_name>" supabase/migrations/*.sql`. Then say in the header
which migration you reproduced from, so the next person can check the same thing in one step.

**The same grep is mandatory before you ANSWER a question about what a function does now.** On
12 Sep the question was "can the account manager approve the task list?". `approve_deliverable_tasks`
was read from `20260911130100`, its FIRST definition — which passes `null` for the account manager
and so refuses them — and the answer given was a confident "no". But `20260911130600` reproduced the
function whole and passed `app.deliverable_account_manager(v.id)`, which ADMITS the AM; pgTAP `103`
asserted exactly that. The answer had to be retracted mid-conversation. A function's behaviour is its
LAST definition, never the one the first grep hit happens to land on — `grep -rln` and read the
newest file before you describe current behaviour, not only before you edit it.

The tell when you get it wrong: a cluster of previously-green assertions failing together, all off by
the same constant. That is a behaviour that came back, not a new bug.

**And the tell can lie about the SIZE of what you did.** On 8 Sep `app.tg_deliverable_transition_guard`
was rebuilt from `20260817110100` instead of the current `20260828210000`, taking with it an
`attribution_party` value — `'reviewer'` — that a later migration had removed from the enum. **Twelve
suites and about fifty assertions failed**, in files that had nothing to do with the change, and it
read as *"the design you just chose breaks everything"*. The design was right; one dead word in one
line was wrong. The change being attempted was nearly abandoned on that evidence.

So when a change fails far more broadly than its blast radius should allow, suspect the reproduction
before you suspect the design. Read one failure properly — the enum cast was named in the very first
error — rather than counting the failures.

### A guard that cannot find its anchor passes silently instead of failing

`memory-lint` gained a rule that every `traps.md` entry must appear in the index. The index is
"everything above the first horizontal rule after the `## Index` heading" — and where that rule was
absent, the code took the whole remainder of the file as the index, so every entry matched and the
check passed while proving nothing.

It only surfaced because the rule was tested by deliberately adding an unindexed entry to watch it
fail. It did not fail. A check nobody has seen fail is a check nobody knows works.

This is the same shape as an unresolvable PostgREST embed coming back EMPTY rather than erroring, and
as `app.in_write_scope` given a null argument (both above): **the absent case defaults to permissive,
and permissive means silent.** When writing a check, decide what happens when its input is missing —
and make that the loud branch, not the quiet one.

*Cost: an hour of the rule appearing to work. Nothing shipped, because it was tested; had it not
been, every future unindexed entry would have gone unnoticed forever.*

### A plain `references resources(id)` is not a tenant fence

Foreign keys ignore RLS by design. A row can legally store the id of another tenant's row; you just
cannot *see* that row. Where it matters, use a composite FK — `(tenant_id, resource_id)` against a
`unique (tenant_id, id)` — so Postgres refuses it for every writer.

`bookings` is fenced a different way: its insert policy calls `resource_in_write_scope(resource_id)`,
which looks the resource up **through RLS**, so a foreign resource comes back invisible and the check
fails. Both are valid; a table with neither has no fence.

### `ON CONFLICT`'s target is an expression context, so an OUT parameter shadows a column

`public.update_task_assignment` and `public.create_adhoc_deliverable` both return
`table(sub_task_id uuid, …)`. Writing `insert into sub_task_reviewers (…) … on conflict
(sub_task_id, user_id)` inside either one raises `42702: column reference "sub_task_id" is
ambiguous` — plpgsql substitutes variables into the conflict target, and the OUT parameter wins.
The INSERT's own column list is fine; only the conflict target breaks.

Use `where not exists (select 1 from t r where r.col = …)` plus a separate guarded `update`, with
every name qualified. That form is also what preserves an existing row's other columns, which
`do update set` silently would not.

### A migration's own trigger refuses the migration's data fix

`20260908150000` widened a transition guard and then corrected the rows that guard had stranded. It
failed on push, at the UPDATE, with `deliverable: sign-off (-> approved) requires reviews:moderate`.

A migration runs as superuser: `auth.uid()` is null, so every `app.has_permission` call reads false
and any trigger that raises on a missing permission refuses the migration. `app.is_system_op()` and
`set local app.system_op = 'on'` exist for exactly this — but the guard only consulted them on ONE of
its branches, and the migration's own header described the behaviour it did not implement.

**When a migration updates rows on a table with a trigger that can raise, check every branch of that
trigger for the system-op escape, not just the one you are thinking about.** Disabling the trigger is
the alternative and it is worse: it skips the bookkeeping the trigger exists to do — here the
readiness check, the sign-off count and the `sla_events` row.

*Cost: one failed push for Edward, and the failure came from the half of the migration written to fix
something else — not from the change under test.*

### `db push` fails on production on a migration that `verify.sh` and the Docker reset both passed

Both places a migration is proved before production are **empty at the moment it runs**: the
throwaway database has no tenant, and `supabase db reset` applies every migration BEFORE
`seed.sql`. A statement that says "for every assigned task…" or "for every role…" therefore touches
zero rows there, and nothing that only fires per row can fire. Production is the first database
where it meets rows. Two faults hid this way on 14 Sep, in one push:

- `55006 cannot ALTER TABLE "sub_tasks" because it has pending trigger events` — a backfill
  `update` on assigned tasks queued the DEFERRED constraint trigger (`sub_task_reviewer_required`,
  fires at commit), and with events queued Postgres refuses to re-enable any trigger on the table.
  Fix: disable the deferred trigger around the fill too (`20260911120000`).
- `P0001 grants of system role power_admin are managed by the platform` — a top-level `insert into
  role_grants … from roles` included the system roles, and `protect_system_role_grants` refuses a
  direct write to them (`20260912100000`). Skip `is_system`; power_admin already gets every new
  catalog entry from `grant_new_catalog_to_power_admin`.

- `23514 check constraint … is violated by some row` (17 Sep, `20260917110000`) — a
  drop-and-recreate of `notifications_type_check` that REMOVED two values. No row of those types
  had ever existed on an empty database; production had them. Fix: delete (or remap) rows of a
  retired value before re-adding the constraint, and say in the file that production is why.

Before a push, read every top-level `update` / `insert` / `alter table … trigger` / **`add
constraint`** in the pending files and ask what it does on a table WITH rows — and prove it on the Docker stack, which has them,
inside `begin; … rollback;`. `I48.31` is the durable fix: `verify.sh` seeding an organisation,
roles and assigned tasks before the migrations under test.

*Cost: two failed production pushes in one afternoon, each rolled back whole; each fix was one line. A third on 17 Sep, same shape, same size of fix.*

### A pgTAP suite cannot prove a lock, and cannot express a race at all

Every pgTAP file is one session inside one transaction that is rolled back. A second connection
cannot see the uncommitted fixtures, so there is nothing for it to race against — `dblink` does not
help.

Nor can you prove `SELECT … FOR UPDATE` ran by inspecting locks: an FK check on a child insert
issues `SELECT … FOR KEY SHARE` on the parent, which takes the **same `RowShareLock`** on the
relation and sets `xmax` on the row. By the time the fixtures are in, both signals are already
present and indistinguishable from the lock you are trying to observe.

Two real sessions or nothing: `scripts/db/race-test.sh` (M4.4, the booking exclusion constraint) and
`scripts/db/race-test-reviewers.sh` (ADR-0043, two mandatory reviewers approving at once). pgTAP can
still cover the *end state* — build it by hand and assert it is recoverable.

### An RPC parameter with a non-null default can never be "not supplied"

`public.save_sub_task(… p_status text default 'todo')` meant `coalesce(p_status, status)` could
never fall through: a caller that changed only the title reopened the task to `todo`, which fired
the clear-approvals trigger and destroyed a mandatory reviewer's recorded verdict. It also
unassigned the task, which is why the deferred required-reviewer rule did not catch the damage.

Any parameter whose absence must mean "leave it alone" defaults to **null**, and the body
`coalesce`s. A bare `set col = p_col` turns an update RPC into a full-row replace.

### A campaign has no brief type, so nothing at wizard time knows which brief is in play

There are two briefs and only one uses a template. `campaign_briefs` rows are per **department**,
generated from `brief_templates` chosen through `department_brief_templates`. The **campaign-level**
brief is the wizard's own step 2 — the deck's 360 Creative Brief — hardcoded in `BriefWizard.tsx`,
which is why `campaign-api.ts` carries the comment *"ADR-0050 d.5: there is no campaign-level brief
type"* and keeps the field only so legacy rows round-trip.

The trap is that `campaigns.brief.briefType` **exists as a field**, so it reads like the answer. It
is not written by anything. And the department briefs do not exist yet while the wizard is open —
they are generated after the campaign is created.

Anything that needs "what work does this brief order?" at wizard time must go **owner → their
department → that department's briefs**, which is what `BriefWizard`'s type picker does.

*Cost: half of I38.1 built on the wrong assumption before the field was checked, 5 Sep.*

### Renumbering `sort_order` in place collides with itself mid-statement

`update workflow_steps set sort_order = sort_order * 10` looks safe and is not.
`uq_workflow_steps_tenant_template_order` is a plain (non-deferrable) unique constraint, so it is
checked **per row as the update walks the table** — and on any template with ten or more steps,
setting row 1 to `10` hits row 10, which has not moved yet. Whether it fails at all depends on the
order Postgres happens to visit rows in.

It passed against the tenants that exist today and failed only when an existing suite provisioned a
**fresh** tenant, where the same statement ran over a different row order. So the local run was
green and the bug was real.

Multiply **and offset** — `sort_order * 10 + 1000` — so every new value is above every old one and
no intermediate state can collide. Then compact back to `1..N` with `row_number()`. Both I38
migrations that reorder steps do this (`20260905090400`, `20260905090600`).

*Cost: one full verify cycle, and it would have reached production if 069/070 had not happened to
provision a new tenant.*

### A user added AFTER `helpers/seed.sql` has no JWT, and the failure says "not found"

`test_claims` is a temp table **built by the seed from the profiles that exist at that moment**. Any
person a suite inserts afterwards is absent from it, so
`set_config('request.jwt.claims', (select jwt from test_claims where id = …))` sets **null** — the
caller lands outside every tenant, and the first thing they touch reports `P0002 … not found`. That
reads as a missing fixture row, not as a missing claim.

Insert into `test_claims` yourself after adding profiles (`json_build_object('sub', …, 'app_metadata',
json_build_object('tenant_id', …, 'app_role_id', …))`), as
`090_who_will_approve_this_brief.sql` does. Changing an existing user's role needs no refresh —
`app.current_role_id()` coalesces to `user_profiles` since `20260824110000`.

*Cost: one confusing run in I40; the same shape as the ordering trap in `082`.*

### A uuid you invented is rejected as invalid input syntax

`'aaaaaaaa-0000-0000-0000-0000000046r1'` is not a uuid — `r` is not a hex digit. The statement errors
at runtime, and the suite reports it as `Bad plan. You planned 10 tests but ran 9`, which points at
the plan rather than the cause. Only `0-9a-f`.

*Cost: one red CI run.*

---

### A pgTAP assertion about `notifications` finds nothing, or finds nothing and passes

`notifications` is recipient-scoped under RLS. A suite that has done `set local role authenticated`
with the ACTOR's claims cannot see the row the actor's own action wrote for somebody else — so
`is((select count(*) …), 1, …)` fails with *have 0, want 1* and sends you looking for a trigger that
did fire.

**The dangerous form is the opposite one.** An assertion that a notification was NOT sent
(`…, 0, …`) passes under the same blindness whether or not the row exists, so a suite can certify a
rule it never tested. `reset role` before reading `notifications`, as `093` does: what is being
asserted is that the row exists, not who may read it.

*Cost: one failing assertion (I42.1, 9 Sep) — and its neighbouring zero-assertion, which had been
passing for the wrong reason in the same run.*

### Sign-in fails with `500 Database error querying schema` on a database you just seeded

**10 Sep 2026, local stack.** Six seeded users, every row correct — role, tenant, claims, bcrypt
password — and `POST /auth/v1/token` answered `{"code":500,"error_code":"unexpected_failure",
"msg":"Database error querying schema"}`. It names no table, no column and no row, and reads like the
database being unreachable.

**Four columns on `auth.users` are nullable with NO default and must still be written as `''`:**
`confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change`. GoTrue scans them
into non-nullable Go strings, so a NULL fails the whole user lookup. (`phone_change`,
`phone_change_token`, `email_change_token_current` and `reauthentication_token` already default to
`''` and are safe to omit — which is exactly what makes the other four look optional.)

Hand-writing `auth.users` is the one part of `supabase/seed.sql` that reaches into another product's
schema, and so the one part a GoTrue upgrade can break. If sign-in dies after a CLI bump, compare the
nullable text columns first.

*Cost: a seed that looked perfect in `psql` and could not sign anybody in.*

### `42501 permission denied for table …` on a fresh database, with RLS never consulted

**10 Sep 2026.** A correctly seeded user signed in, and every read returned
`permission denied for table campaigns`. Not RLS — the `authenticated` role held **no table privilege
at all**.

**200-odd migrations create tables and force RLS, and not one grants a table privilege.** Production
works because that project was created when Supabase gave `authenticated` `arwd` on `public` by
default; the current CLI grants only `Dxtm` (truncate, references, trigger, maintain). The door rules
are perfect and nobody has a key to the building.

**`verify.sh` cannot catch it**, which is the part worth remembering: `scripts/db/local-stub.sql`
sets those default privileges itself before migrations run, so the whole pgTAP suite passes against
grants the real schema never asks for. Any fresh Supabase project — staging, a region move, a rebuild
— fails the same way.

Tracked as `I43.2`, with a stand-in at the head of `supabase/seed.sql`. **A blanket `grant all` is the
wrong fix**: four narrowings are deliberate (`user_profiles` replaces table-wide UPDATE with a
three-column grant; `sla_events`, `audit_events` and `campaign_concepts` are append-only), and
`revoke update on <table>` drops column-level grants with it — so the ORDER decides whether the audit
log stays append-only.

**13 Sep variant — the same 403 after `supabase migration up`, on a database that WAS reset.** The
seed's stand-in grants on "all tables in schema public" at the moment it runs. A table created
afterwards by `migration up` (here `office_closures`, embedded by the schedule's resources read) has
no grant, and every read that touches it is 403 — RLS never consulted. Either `db reset` again, or
grant it by hand; `20260913190000` now grants it explicitly, the precedent `20260911122000` set.
**A migration that creates a table should carry its own grant** until `I43.2` settles the general
answer.

*Cost: an environment that signed in and showed nothing, and the discovery that the suite proving RLS
has never proven the grants underneath it.*

**`service_role` is in the same boat, and it bites the Edge Functions (12 Sep).** The stand-in
granted `authenticated` but not `service_role`, so an Edge Function running as its admin client —
`chat` opening a conversation, `notify-email`, the transition functions — 500s with `permission
denied for table conversations` on a fresh local DB, while `authenticated` reads fine. Production's
service_role has these grants by default; the CLI-provisioned one has nothing. The seed now grants
`service_role` select/insert/update/delete on all tables (no narrowings — it is the trusted backend
role, not a person). Same symptom shape as above, one role over.

### `supabase db dump --linked` fails with "failed to connect to the docker API" — it looks local, it is not

15 Sep, backing up production before a push: the same command that worked the day before failed
with `failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. The
Supabase CLI ships no `pg_dump`; `db dump` starts a throwaway `supabase/postgres` container to run
it, and that container connects OUT to the hosted project. Docker is only the tool-box — the dump is
the remote, `--linked` or not — but with Docker Desktop closed there is no tool. It had been open the
day before because the local stack was up; it was closed overnight.

Start Docker Desktop, wait for "running", rerun. (A native `pg_dump` with the session-pooler
connection string is the no-Docker route, but the linked command is what the RUNBOOK names.)

*Cost: twenty minutes and a flat argument about whether yesterday's backup had been of the local
database. It had not — the file holds the live clients.*

### `supabase migration up --local` refuses to run anything after you switch branches

*22 Sep. One new migration to apply to the local stack; the CLI answered
`LegacyMigrationMissingLocalError — Remote migration versions not found in local migrations
directory`, and suggested repairing the migration history or pulling the schema. Both of those are
answers to a different problem.*

**The cause is the branch, not the database.** The local database's `supabase_migrations.schema_migrations`
still held six migrations from the OTHER feature branch, whose files do not exist on the branch now
checked out. The CLI compares the table against the directory, finds versions it cannot account for,
and refuses to do anything at all — including applying the one new file, which has nothing to do with
them. Nothing is wrong and nothing needs repairing.

**What to do:** apply the single file directly and record it —
`psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/migrations/<file>.sql`, then
`insert into supabase_migrations.schema_migrations (version, name) values ('<version>', '<name>')`.
Never run the suggested `migration repair --status reverted` on those six: they ARE applied, and
telling the table otherwise would re-run them on the next switch back.

**The same confusion, one level up:** with two feature branches open, a red CI run is not
necessarily the branch you just pushed. The database job's own output identifies it —
`Files=N` is that branch's pgTAP file count (142 on `main`, 143 and 147 on the two branches that
evening), so the count names the branch before the run page does. Half an hour went on explaining a
failure that belonged to the other PR.

### A new table has its tenant tag, RLS and audit trigger, and pgTAP 123 still fails it

*22 Sep. `scope_acknowledgements` was written against the `maestro-migration` checklist — `tenant_id`,
RLS enabled and forced, policies, the audit trigger, all in one file — and CI failed two assertions in
`123_every_row_says_who_made_and_changed_it.sql`.*

**`created_by` / `updated_by` and the `set_actor_columns` trigger are a standing rule too** (I51.1),
and they are NOT in the migration skill's checklist. 123 reads the catalogue — every table carrying
`tenant_id`, minus the four logs that are themselves the record — so the omission cannot hide, but it
is only caught after the migration is written, and by then the file may be pushed and has to be fixed
forward (`20260922200000`).

**Add them with the table**, not afterwards. Note that a domain column naming a person is not a
substitute: this table already had `recorded_by` (who took the client's answer down, a fact about the
conversation) and still needed the two standing ones (who wrote the row).


## Authorization

### A person who can create the parent row is refused writing its child, and the policies "match"

A user who was not the client's account manager opened a single job on production (15 Sep): the
draft campaign was created, the request text saved — and the receipt row (`campaign_brief_receipts`)
was refused. The receipts policy had been written as *"the campaign's own write rule, verbatim"*
(`20260903100200`), and it WAS, for five hours: `20260903150000` then replaced the campaign's rule
on Edward's instruction (permission governs, not account scope) because the same person-is-not-the-AM
refusal had just hit the campaign wizard. Nobody re-read the copy. Reading either policy alone
showed nothing wrong; only putting the two side by side did.

**A policy described as "the same as table X's" is a copy, and copies drift.** When a write rule
moves, grep for every policy whose comment names it and move those too — or better, have the child
policy call the same function as the parent so there is one rule. And the local retest never saw it
because every capture ran as the client's own AM; the fixture that would have caught it is the
colleague, not the owner (`p-capture-and-add-task.spec.ts` P1 now is).

*Cost: a real user lost their evidence and was refused at Approve with a sentence that named nobody;
twelve days on production; a morning to find because the friendly dialog carried no cause
(`I48.39`).*

### Holding the permission is not the same as being in scope

Two independent axes (ADR-0037): `app.has_permission` and `app.in_write_scope`. A user can hold
`project_tasks:manage` and still be refused, because their role's reach is `self` and
`in_write_scope` returns false for every scope it does not recognise (`else false`).

When a refusal makes no sense, check the **scope** axis before the grant. The pgTAP seed
deliberately gives `a003` `project_tasks:manage` so that scope tests prove scope decided it.

### A null argument to `in_write_scope` silently kills a whole class of approver

`app.in_write_scope(dept, team, account_manager)` decides by a `case` on the caller's role scope, and
each branch reads **one** of the three arguments. Pass null for an argument and that branch can never
be true — so a grant sits on a role, is visible in `role_grants`, is asserted by tests that check the
*permission* axis, and is unreachable. The symptom is `42501 … outside your scope` for somebody who
plainly holds the grant, which sends you looking at grants.

**Three instances, and the third and fourth were shipped after the first was written down here:**

| Call | Null argument | Who it silently excluded |
|---|---|---|
| `app.resource_in_write_scope` → `(dept, team, null)` | account manager | an Account Manager's role scope authorises no resource-scoped booking write; theirs comes from a per-user scope grant or the PM bypass |
| `approve_department_brief` → `(dept, null, null)` | team | a **Team Leader could not accept their own department's brief**, though ADR-0070 d.3 says in as many words that they may |
| `approve_department_brief` → `(dept, null, null)` | account manager | the campaign's **Account Manager** could not either, though ADR-0070 d.2's 3 Sep amendment added `briefs:approve` to the role precisely so they could — the grant was unreachable from the day it was seeded |
| `sub_tasks_manage_insert` → `(department_id, team_id, AM)` **of the row**, where the add form wrote the ASSIGNEE's department — null for an unassigned task | department, team | the deliverable's **owner** could not add an unassigned task to their own list (production, 15 Sep, `I48.42`). A policy that reads the row's columns is a call site too: what the WRITER puts in the row is the argument. Fixed by `save_sub_task` defaulting the department from the deliverable (`20260915130000`) |

**Check every `in_write_scope` call site by its arguments, not by its name.** Two of the three above
were found only by asserting each intended approver individually; reading the function told nobody
anything was wrong, and `082_department_brief_approval.sql` exercised a Department Lead and the
failsafe roles and passed throughout.

A second lesson sits on top of it: **an accepted ADR's sentence is not evidence the code does it.**
Three sentences were false in the code on 5 Sep — the two above, plus ADR-0067's promise that a draft
is *"resumable"* when only step 1 was ever saved. When a decision and a symptom disagree, test the
code before trusting either.

*Verified in `supabase/migrations/20260812120100_scope_helpers_and_policies.sql:43-49` and
`20260905210000_who_will_approve_this_department_brief.sql` (I40.13, I40.14). Cost: two live
refusals Edward hit while testing, and roughly a session between them.*

### Permissions are fail-closed, so "not loaded" looks exactly like "refused"

`can()` returns false until the grant fetch resolves. Correct for enforcement, wrong for UI: a screen
that gates on a permission must distinguish *loading*, *load failed*, and *genuinely not allowed*, or
a network blip renders as a refusal. `usePermissions()` exposes `ready` and `failed` for this.

### A human resource can never trip the exclusive-overlap constraint

`chk_resources_human_load` forces every `kind = 'human'` resource to `capacity_model = 'load_based'`,
and `excl_bookings_confirmed_exclusive_overlap` only fires on `confirmed` + `exclusive`. So people do
not clash — they accumulate load past a warn threshold and a ceiling. Equipment and rooms clash.

Any "conflict detection" that must cover both has to handle two different shapes.

---

### A picker offers work the gate then refuses — the screen and the trigger answer the same question from two places

**Symptom (20 Sep, I53.12):** on an approved campaign whose departments had written no brief, the
`/schedule` `+` picker listed every deliverable; picking one listed its tasks; submitting was
refused. Edward read it as *"you are making deliverables available for assignment when the tasks
have not been approved"* — and it had been decided three times (ADR-0070 d.4, ADR-0072 d.6,
ADR-0090 d.3a).

**Cause, two halves.** (1) `app.sub_task_brief_is_approved` still carried ADR-0070 d.5's *"absence
is not refusal"* — true when the brief row did not exist — two weeks after ADR-0072 d.6 had put
generation INSIDE the gate. The ADR was accepted; the function was never re-read against it. (2) The
picker's held rule lived in the CLIENT (`kind === 'single_job' && tasksApprovedAt === null`), so it
answered one of the gate's three questions and left the other two to the submit. Two places, two
answers, and the screen's was the looser one.

**And the third half, found on review.** The first fix kept an exemption for "a deliverable with
no department". Edward: *"it is not possible for a deliverable not to be assigned an owner"* — every
door requires the owner and the department is stamped from it. An exemption for a state the product
cannot produce is a hole, and six older pgTAP suites were quietly relying on it (deliverables
inserted with no owner, then assigned). They now call `test_accept_campaign_work()` from
`helpers/seed.sql`, which puts the campaign in the state the product would have.

**Rule.** A surface that offers work must ask the gate's OWN function — `app.deliverable_work_acceptance_refusal`
through `public.assignable_deliverables` — never a re-derivation of it. When an ADR narrows an
earlier decision (0072 d.6 over 0070 d.5), grep for the function that implements the earlier one in
the same session; an accepted ADR with no migration behind it is the trap, not the fix.

## Frontend

### A deadline is a DAY stored as a MOMENT, and the screens are right only by accident

`due_at`, `go_live_at` and the leave dates are `timestamptz`, but nobody picks a *moment* for a
deadline — they pick a day, and the app writes it as **midnight UTC** (`${day}T00:00:00Z`, see
`DeliverablesPage`). About nine surfaces then render `dueAt.slice(0, 10)`, which prints the UTC day.

Both halves are wrong and they cancel out, so everything looks correct. It stays correct only while
every user is **east of UTC**, which today they all are. Convert one of those renders to the reader's
local clock — the right rule for a genuine timestamp, and what `I3.4`/`I4.4`/`I5.3`/`I3.5` now do —
and the deadline jumps **back a day** for anyone west of UTC.

So: do not "fix" a `slice(0, 10)` on a due date the way you would fix one on a `created_at`. They
look identical in the diff and are opposite problems. A real timestamp (created, uploaded, sent,
posted) is stored UTC and displayed local; a deadline is a day wearing a timestamp's clothes.
Tracked as `I1.7` in `docs/TASKS.md`, with options and a recommendation — it needs Edward, and
likely an ADR.

*Cost: I asserted the opposite (that due dates must stay UTC-anchored), Edward challenged it, and
the schema settled it — the column type alone does not tell you which kind of value it holds.*

### `src/types/database.ts` lags one migration behind

It is generated by `supabase gen types` and never hand-edited (`AGENTS.md` §1). Between a `db push`
and the regeneration, new tables and columns do not exist as far as TypeScript is concerned. That gap
is what `supabaseUntyped` in `src/lib/supabase.ts` is for — the same client, untyped. Migrate call
sites back to the typed client once types regenerate. 28 files currently use it.

### A test that reads a source FILE fails after an edit that `git diff` shows as clean

**10 Sep 2026.** `notification-copy.test.ts` began failing with *"could not find the COPY map"* after
an edit to `notify-email/index.ts` that added an import and one block. `git diff --numstat` said
`14 0` — fourteen lines added, nothing else — and the map was plainly still there.

**The edit had rewritten the whole file from LF to CRLF.** `core.autocrlf=true` on this machine, so
git normalises line endings on the way in and the diff is honest about the *content* while saying
nothing about the *bytes on disk*. The regex looked for `
}
`; the file now held `
}
`.

**The mechanism is any tool that writes text on Windows**, including a Python `open(path, 'w')`
helper — text mode translates `
` to `
` on write. It converts the ENTIRE file, not the lines
you touched, and this repo's working tree is already mixed (`asset-url/index.ts` is CRLF,
`src/lib/version.ts` is LF), so there is no consistent state to compare against by eye.

**Only tests that read source as TEXT can see it** — `notification-copy.test.ts` and
`postgrest-selects.test.ts` — which is exactly two files in the suite, so the failure looks unrelated
to what you changed. Everything else compiles and runs identically.

Write bytes, not text: `open(path, 'wb')`, or `newline=''`. To check: compare
`open(f,'rb').read().count(b'
')` against `git show HEAD:<f>`; if the working copy has CRLF and
HEAD does not, the edit did it.

*Cost: two failing assertions that named neither the file nor the cause, and a diff that looked correct.*

### A new `api/` module makes unrelated suites fail in CI but pass on your laptop

`src/lib/env.ts` Zod-parses `import.meta.env` at import time and THROWS when the `VITE_` vars are
missing. They are present locally (`.env`) and absent in CI. So any module that reaches
`lib/supabase` poisons every suite that imports it, however indirectly — and only on the runner.

It bites when a component gains a new import. `DeliverablesPage.test.tsx` mocked
`api/deliverables-api` for exactly this reason; adding `TaskResources` to the page pulled in
`api/task-resources-api` as well, which nothing mocked. Green locally, red in CI, and the error names
Zod rather than the test.

Mock the new module, or stub the component that reaches it — the convention here is a stub with a
marker testid, as `ChatPanel` and `ReviewPanel` already are.

**Reproduce CI locally before pushing** — it takes seconds and there is no excuse for finding this on
the runner:

```bash
mv .env .env.bak; mv .env.local .env.local.bak
npm test
mv .env.bak .env; mv .env.local.bak .env.local
```

### A permissively-licensed package can still fail `check:licenses` on its dependencies

`mammoth` is BSD-2-Clause, which is exactly what ADR-0044 verified against the registry. It still
fails the gate, because three packages *underneath* it do: `duck@0.1.12` declares the legacy
non-SPDX string `BSD` (its LICENSE text is plain BSD-2-Clause), `jszip@3.10.1` is
`(MIT OR GPL-3.0-or-later)`, and `pako@1.0.11` is `(MIT AND Zlib)`. The checker splits compound
expressions and requires **every** id to be on the allowlist, treating `OR` like `AND` on purpose —
so a dual MIT/GPL package needs a human to elect MIT, and `Zlib` is simply not listed.

Check the whole tree before promising a dependency will pass: `npm run check:licenses` after
installing, not `npm view <pkg> license` before. Widening the allowlist or electing a dual license
is an ADR-0002 decision — Edward's, never an agent's.

*Cost: found at the end of I14.3, after the feature was built.*

### An Edge Function's logic can be unit-tested — put it in a `handler.ts`

Vitest cannot load `index.ts`: `Deno.serve` runs at import time. Split the function so `index.ts` is
only environment reading plus `Deno.serve`, and a sibling `handler.ts` holds the logic with its
runtime (clients, keys, `fetch`) injected as arguments. `vitest.config.ts` aliases `npm:zod@4` to the
installed `zod` and includes `supabase/functions/**/*.test.ts`, so the test exercises the real
function rather than a copy of it. `ingest-brief` is the worked example.

Note the limit: `tsc -b` still only covers `src`, so `handler.ts` and its test are transpiled but not
type-checked — same as every other Edge Function.

### A slow await + `setState(value)` silently reverts everything typed meanwhile

An async handler closes over the state from the render that created it. Write that snapshot back
after the await — `setS(mergedFromStaleSnapshot)` — and every edit made during the wait is gone. The
Brief Wizard's ingest call can take 45 seconds, the form stays editable throughout (correctly), and
the field the user had just typed into came back holding the model's text and marked "from the
uploaded brief": the precise inverse of what ADR-0044 §5 promises.

Nothing warns you. It only appears when the await is slow enough for a human to type into the gap,
so a fast local stub never reproduces it, and a test that ingests into an idle form passes.

`setS(prev => ...)` fixes one setter. When the outcome ALSO feeds other state — which markers to
show, what the message says — a functional update per setter tears them apart instead, because each
one recomputes from a different base. Move the whole transition into a `useReducer` action: the
merge happens once, inside the reducer, against the state as it is at that moment, and every slice
is derived from that one result. `BriefWizard.tsx` is the worked example.

Test it by holding the promise open: resolve it manually after firing the intervening edits.

*Cost: found in review, not by the suite — every existing ingest test used an idle form.*

### The Figma page is too large to read, and a screenshot per screen burns the context

**10 Sep 2026.** `get_metadata` on the `▶ CS Flows` page returned **771,000 characters** — over the
tool limit, saved to a file, with an instruction to read it all. Six screens were needed. The
obvious next move, a screenshot per screen, costs a large image each and tells you the layout, not
the fields.

**The text is already in the metadata: every text node's `name` IS its content.** A field label, a
hint, a whole paragraph of designer's notes — all present as `name="…"` on `<text>` elements. So
extract the subtree for one frame id from the saved dump and print its text-node names, and you
have every label, every piece of copy and every note on that screen, for nothing. Six screens plus
their notes came to under 300 lines. Only take a screenshot when the question is genuinely visual.

**Two things that go with it.** Each screen has a paired `… · notes` frame beside it carrying the
designer's intent in one paragraph — read those FIRST, they are the specification. And names are
JSON-escaped in the saved file (`\"`), so grep the parsed text, not the raw file.

*Cost: one blown tool call and the temptation to spend six screenshots on what four lines of
extraction gave.*

### i18next plural keys are `_one` / `_other`, and Arabic's full set breaks the parity test

Not `key` + `key_other`. A wrong suffix does not error — it silently renders the key name.

**The half this entry was missing.** `src/lib/i18n.test.ts` asserts EN and AR hold *exactly* the same
key set, so writing correct Arabic plurals — CLDR gives it six categories, `_zero` `_one` `_two`
`_few` `_many` `_other` — **fails the build**, because EN has only two of them. Matching EN's two
instead puts grammatically wrong Arabic in the file.

There is no way to have both, so **the house convention is to avoid i18next plurals entirely**:
`deliverables.confirmCancelBookings` is `'{{n}} booking(s) will be released.'`, and
`signOffUnassigned` is `'{{count}} task(s) …'`. One key, one set, parity holds, and neither language
is made ungrammatical by the other. Follow it — the convention is invisible until the test rejects
the obvious thing.

*Cost: written twice (I42.3, 9 Sep) — once with Arabic's real plural set, then again to the
convention, after the parity test named four keys EN did not have.*

### Work that is finished, cancelled or called off will not leave somebody's My Work

**9 Sep 2026, live tenant.** A Team Member reported that tasks assigned to her and since approved
were still in her *Tasks for today*. **Three readings of this were wrong before the data settled
it**, and each was plausible enough to have shipped a fix for a defect that was not there:

1. *The Completed panel is unbounded and she is seeing it.* No — she was looking at Today.
2. *The classifier is broken.* No — `isFinished` was correct for every task it was asked about.
3. *The cancel did not persist.* No — `sub_task_cancel` had done exactly the right thing.

**The cause was one state nothing knew about: a live task under a DEAD CONTAINER.** Somebody had
archived the deliverable while the task under it was still `todo`. `public.sub_task_cancel` guards
this from its own side — it archives an ad-hoc job only when no live task remains — but the
container's own transition looked at the tasks not at all, and `isFinished`
(`src/features/deliverables/lib/my-work.ts`) tested only `deliverableState = 'approved'`, never
`archived` or `delivered`.

**The reason it is worth an entry is who could fix it: nobody.** The assignee has no authority to
cancel her own work; `DeliverablesPage` hides every task control once a container is `approved` or
`archived`, so the manager's modal offers no Cancel either; and `archived` is terminal (ADR-0024) so
the container cannot be reopened to reach the task. Six tasks across four people were in that state
and no surface in the product could touch any of them.

**So when a list will not let go of something, ask what the row's CONTAINER is doing before
suspecting the list.** Fixed by ADR-0080 (`20260909120000`): archiving now cancels the work under it.

*Cost: most of a session, three wrong diagnoses, two of them written up before the data arrived.*

### Two screens disagree about the same task's reviewers, dates or flags

**9 Sep 2026.** A reviewer marked *required* on `/deliverables` showed as not-required when the same
work was opened from `/schedule`. Both surfaces read through **one** function
(`src/lib/reviewers/task-reviewers-api.ts`), deliberately, so they cannot disagree — which made the
report look impossible and sent the diagnosis into the write path, the RLS, the trigger guard and
the RPC. All of them were correct.

**They were two different `sub_tasks` rows with the same title.** Ad-hoc work creates one deliverable
per task named after the task, so duplicates are invisible in any list: "Mr Crunch KV and SM
direction" existed twice, 41 seconds apart, each with its own reviewer appointments — required on
one, not on the other. Set the flag on the row in front of you, open the other, and the screen is
telling the truth about something else. The same tenant had one piece of work existing as **five**
separate jobs.

**Before believing that two surfaces disagree, check they are looking at the same row id.** A query
grouped by title with `count(*) > 1` settles it in seconds; comparing the two code paths does not,
because there is nothing wrong with them.

*Cost: a full wrong diagnosis, and an ADR section written and then rewritten.*

## A booking that "disappeared" was silently moved to another day

**27 Aug 2026, live site.** A task assigned for Sunday 30 August appeared on Monday 31 August.
Nothing said it had moved, so it read as a booking that failed to save.

**Cause:** the office's `working_days` did not include Sunday (ISO 7). Automatic placement
(`src/lib/bookings/subtask-spread.ts`) ends with
`all.filter((d) => office.workingDays.includes(d.isoWeekday))` — a non-working day is not
rejected or warned about, it is removed from the candidate list, so the work lands on the next
working day with no notice.

**The manual path disagrees.** `capacity/engine.ts` treats the same situation as a warning:
*"non-working days warn; never hidden, never blocked"*. Two paths, two behaviours, one of them
silent.

**When debugging "the booking is not on /schedule", check in this order** — an afternoon was lost
going the other way round:

1. **Does the row exist at all?** `select * from bookings order by created_at desc limit 20` with
   no filters and no joins. Every narrowing query risks excluding the row you are looking for.
2. **Is it on the day you think?** Times are UTC; Baghdad is +3, so an early-morning local booking
   is the previous day in UTC. Do not filter on a bare date literal.
3. **Is it the person you think?** Two people can share a first name — this hunt spent three
   queries on the wrong Fadia, and before that on an unrelated resource entirely.
4. **Is it the week you think?** `/schedule` starts weeks on Sunday and shows 7 days, so "there is
   a Sunday column" does not mean it is the Sunday you want.
5. Only then look at `is_active`, RLS scope and office configuration.

Recorded as `I17` in `docs/TASKS.md`, with Edward's requirement: warn on a non-working day or an
unavailable resource, and allow the booking when the user confirms proceed anyway.

## `authenticated` may update only three columns of `user_profiles`

**29 Aug 2026, writing pgTAP for the ADR-0053 d.5 department restamp.** Two test runs were spent
proving a trigger from an authenticated actor before noticing that no authenticated actor can reach
the column at all.

`20260801090000:34` is `grant update (display_name, locale, office_id) on user_profiles to
authenticated` — a **column-list** grant, so everything else (`department_id`, `team_id`,
`role_id`, `is_active`) is writable only by the service role. Every organisational change to a
person therefore goes through the `update-user` Edge Function, which builds a service-role client.

Two consequences worth having in hand before writing anything that reacts to a profile change:

- **`auth.uid()` is null on that path**, so any trigger guard shaped like
  `if not has_manage and v_actor is not null` stands down on its own — including
  `app.tg_deliverable_transition_guard`.
- **A pgTAP test must `set local role service_role`** to model it. `set local role authenticated`
  with a power-admin JWT fails with `permission denied for table user_profiles`, which reads like an
  RLS refusal and is not one: RLS says *"new row violates row-level security policy"*, a missing
  GRANT says *"permission denied for table"*. The two messages are the fastest way to tell which
  layer refused.

*Cost: two verify.sh runs and a wrong premise written into a test comment.*

## A seeded table with no reader in `src/` is a feature that cannot be used

**29 Aug 2026, found the morning after I19 was marked complete.** `deliverable_types.default_workflow_template_id`
is the field `app.materialise_deliverable_workflow` reads to decide which task list a deliverable
type implies. The column existed, had its foreign key, and was read by the engine. **Nothing ever
wrote it** — no seed, no migration, no screen. All 240 types held null, so setting a type created no
tasks, and I19 was inert in production while every one of its tasks was ticked.

**Why nothing caught it:**

- **pgTAP `065:52` sets the field in its own fixture** before exercising the materialiser. It asked
  "does the engine work when a type has a template?" and never "can a type ever get one?".
- The Admin screen was named in one line of ADR-0052's prose and never became a task ID, so there
  was no unticked box.
- `grep -rn "workflow_template" src/` returned **nothing** — an entire feature with 14 seeded
  templates, 154 steps, a materialiser and a pgTAP suite had no frontend surface at all.

**The check, worth running whenever a seeded table lands:**

```sql
select count(*) from <table> where <the field the engine reads> is not null;
```

and its static twin: `grep -rn "<table>" src/`. A seeded table nothing in `src/` reads is a feature
nobody can reach. **Two known instances remain**: `sub_task_dependencies` (ADR-0052 d.16 — the
engine, cycle guard and notifications exist; nothing can draw an edge) and Library filing
(`I11.4` — `deliver_deliverable_version` has no callers).

*Cost: a full night's work marked done, discovered by the acceptance checklist rather than by a test.*

---

## `not null default` cannot tell "never chosen" from "deliberately chosen"

**Where it bit:** ADR-0059's seed. `workflow_steps.review_mode text not null default 'digital'`, and
the seed needed to mark 32 of 97 steps `manual` **without overwriting a tenant's own decision**. The
fills-blanks-only rule that works everywhere else (`I19.13`'s default-workflow mapping,
`seed_tenant_taxonomy_amendments`) needs a blank to find, and this column has none: a step somebody
deliberately set to `digital` is byte-identical to one nobody has ever looked at.

**What it looks like when it goes wrong:** a re-runnable seed that silently reverts a considered
edit, and nobody notices because the value it wrote is also a plausible value.

**The three ways out, in order of preference:**

1. **Make the column nullable**, null meaning "not chosen", and resolve the default at the point of
   use. Honest, and the only option that stays correct forever. Costs a `coalesce` in every reader.
2. **Run only at moments where everything genuinely IS the default** — a one-time migration for
   existing tenants, and a per-tenant seed that runs immediately after the rows are created. This is
   what ADR-0059 does, and it is safe *because those are the only two call sites*. Write that
   dependency down, because a third caller added later would break it silently.
3. Add a separate `<field>_set_by_tenant boolean`. Rejected here: a second column to remember whether
   the first one means anything is exactly the two-homes shape that has bitten this project twice
   (ADR-0037; `I12.14`).

**The general form:** *fills blanks only* is only a safe idempotence rule when a blank is
representable. Check that before reaching for it.

*Cost: caught in design rather than in production, but only because the seed was being written at
the same time as the column. Written down so the next `not null default` does not get the
fills-blanks-only treatment on reflex.*

---

## A component test dies at IMPORT when a new import reaches `lib/env`

**Where it bit:** ADR-0059, 30 Aug. `AwaitingReviewPanel` gained one import — `TaskReviewThread` —
which imports `api/review-api` → `lib/supabase` → `lib/env`, and `lib/env` does
`EnvSchema.parse(import.meta.env)`, which **throws** when `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` are absent. They are absent in CI and present in every developer's
`.env`, so the suite passed locally 1169/1169 and CI reported `Test Files 1 failed`.

**Why it is nasty:** it is not an assertion failure. The file never loads, so vitest reports
`(0 test)` and the error arrives as a raw `ZodError` pointing at `src/lib/env.ts:13` — three
modules away from the line that caused it, and naming no test. The count still reads green-ish
(`1160 passed`), because the missing file's tests are simply not there to fail.

**The rule:** a component test must mock every import path that reaches `lib/supabase`. The suites
that already do it say so in their headers (`WorkflowTemplatesPage.test.tsx`: *"the api module
reaches lib/env (throws in CI), so it is mocked"*). **Adding one import to a component can break a
test file that does not mention it** — the chain is transitive and nothing warns.

**A mock that calls `vi.importActual` is not a mock.** Second occurrence, 2 Sep (I34.4): the api
module *was* mocked, with a factory that spread `...await vi.importActual(...)` so the real
`BriefEmptyError` class could be reused for an `instanceof` check. `importActual` loads the real
module — `lib/supabase`, `lib/env`, throw — so the mock imported the very thing it existed to keep
out, and CI failed exactly as above while the suite was green locally.

List every export explicitly instead. Where the test needs a *class* the component compares with
`instanceof`, build it inside `vi.hoisted` and return it from the factory, so both sides share one
identity:

```ts
const state = vi.hoisted(() => {
  class BriefEmptyError extends Error {}
  return { BriefEmptyError, /* …fixtures… */ }
})
vi.mock('../api/concepts-api', () => ({ BriefEmptyError: state.BriefEmptyError, /* …hooks… */ }))
```

**Third occurrence, 3 Sep (I35.8), and the fix was NOT a mock.** `components/FolderPicker.tsx` — a
deliberately dumb presentational component that fetches nothing — imported one function,
`breadcrumbWithin`, from `lib/assets/folders.ts`. That file holds the TanStack hooks, so it imports
`lib/supabase` → `lib/env`, and the component's test file died at import in CI having passed
locally 12/12.

Mocking `lib/assets/folders` in that suite would have worked and would have been wrong. **The
symptom was a shared UI primitive able to reach the database client**, which is the thing
`AGENTS.md` §3 is trying to prevent — and a mock hides exactly that. The pure half (the
`AssetFolder` shape, `breadcrumbWithin`, `campaignRoot`, `brandRoot`, `isDuplicateFolderName`) moved
to `lib/assets/folder-tree.ts`, **which imports nothing**; `folders.ts` re-exports it so existing
callers are unaffected.

**When a component's test dies on `lib/env`, ask which of the two it is:**

- the component legitimately needs data, and its api module must be mocked — the cases above; or
- the component needs a TYPE or a PURE FUNCTION and is dragging a client in behind it, in which
  case split the module and the mock is not needed at all.

**Reproduce CI locally before pushing** — the whole family is invisible with a `.env` present:

```bash
mv .env .env.bak; mv .env.local .env.local.bak    # if present
npm test
mv .env.bak .env; mv .env.local.bak .env.local
```

**Fourth occurrence, 6 Sep, and the recipe above would have caught it.** `BriefWizard.test.tsx`
imported nothing new — `BriefWizard.tsx` had imported `fetchAssetDownloadUrl` from
`features/library/api/library-api` for some time, unmocked, and the suite happened to stay green
until a locale change made CI run it against a different cache. `(0 test)` again.

**The distinction worth knowing, because it makes the whole family checkable:** a `import type { X }`
is ERASED at compile time and can never load the module — safe. A **value** import always loads it.
So a static walk of a test file's unmocked import graph, counting only value imports, tells you
whether the file is exposed before CI does. Thirteen suites reach `lib/supabase` on paper; all but
this one did so through type-only imports.

*Cost: three CI failures for one root cause, each green locally.*

*Cost: a second red CI run, on a file whose own header said the api is mocked because it reaches
`lib/env`.*

**Reproduce it locally in ten seconds**, which is the only reliable check:

```bash
mv .env .env.bak && mv .env.local .env.local.bak
npm test
mv .env.bak .env && mv .env.local.bak .env.local
```

Do that whenever a component gains an import, before pushing.

*Cost: one red CI run, and a diagnosis that started in the wrong place — the failure was read as the
`database.ts` type lag, which was unrelated and would not have failed anything.*

---

## A composite tenant fence REPLACES the inline `references`, it does not accompany it

**Where it bit:** twice in one day, 30 Aug. `departments → brief_templates`, caught before it
shipped; then `department_brief_templates → departments` and `→ brief_templates`, which shipped and
blanked the whole Brief templates screen.

The house pattern for fencing a tenant is a composite FK, because a plain FK cannot check that both
rows belong to the same tenant and RLS is invisible to foreign keys:

```sql
alter table child
  add constraint fk_child_parent
  foreign key (tenant_id, parent_id) references parent (tenant_id, id);
```

The trap is writing that **as well as** the ordinary inline one:

```sql
parent_id uuid not null references parent(id),   -- ← this is a SECOND foreign key
```

Two keys between the same pair of tables means **PostgREST cannot choose**, and it does not guess:
it rejects the entire select with a 400, including every other column in it. So one embed anywhere
takes out the whole query.

**What it looks like:** a screen that renders nothing, or a list that is empty rather than wrong.
`data` comes back undefined and a caller that does `data ?? []` shows a tidy empty table. Nothing
mentions the 400 unless the surface was written to report a failed read — which is the second half
of the fix both times.

**The check, before any migration with a composite FK:**

```bash
grep -n "references" supabase/migrations/<file>.sql
```

Two lines naming the same parent table is the bug. Delete the inline one.

**And when a read fails, say so.** `isError` and an empty result must never render the same way;
a blank list is a claim that there is nothing, and that claim is the thing that was wrong here.

*Cost: an admin screen shipped blank, and the same mistake made twice in six hours because the
first one was fixed silently in a file rather than written down.*


## A second route with the same path wins nothing, silently

React Router matches the **first** entry for a path. Declare one twice and the later element is
unreachable: no error, no warning, no failing test, a green build, and a page that simply never
renders.

`800666c` (27 Aug) added `CampaignPage` at `/campaigns/:campaignId` and left `CampaignStatusPage`
declared at the same path a few lines below. The campaign's delivery-status rollup — progress,
blocked, overdue — was invisible from that moment. It was found on 31 Aug only because Edward asked
why a campaign showed no health figures.

**A duplicate path is never intentional**: two elements cannot both answer one URL, so the second is
always dead code, whichever one was meant to win.

`src/app/router.test.ts` now reads `router.tsx` as text and fails the build on any repeated `path:`
literal. It reads the file rather than importing the route table on purpose — importing it pulls in
every page component and reaches `lib/env`.

*Cost: four days of a shipped surface being invisible, and nobody could have noticed from the code.*

## The browser bundle and the Edge Function deploy separately — a response shape cannot change in one step

Client code reaches the user the moment Vite rebuilds. An Edge Function reaches them when somebody
runs `supabase functions deploy`. Between those two, **new client code is talking to an old
function**, and that window is however long it takes to notice.

This bit twice in one hour on 31 Aug, from a single change that added a field to `conversation_people`:

- The member list read `p.subjects.length` on a response that did not carry `subjects`, and
  `Cannot read properties of undefined` took the whole page down through the error boundary.
- The same change renamed the `assigner` reason to `creator` and **deleted the old locale keys**.
  The deployed function still sent `assigner`, and i18next returns the key when it cannot find one,
  so the screen filled with `chat.reasonMany.assigner`.

**The rules that came out of it:**

- A reader must survive a field that is not there yet. Type it optional if a deployed thing can omit it.
- **Never delete a locale key while any deployed thing can still emit its value.** Keep it as an
  alias until the old emitter is gone. This is the third occurrence of the family — see the
  `notifications.type.cancelled` entry.
- Anything that maps a server value to copy wants a test that walks the vocabulary and asserts every
  value has a string (`src/features/chat/reason-copy.test.ts` is the pattern).

*Cost: a white screen, then a screenful of debug text, both in front of Edward, both from one change.*

## `supabase gen types` can write UTF-16, and nothing downstream complains

On 31 Aug `src/types/database.ts` came back **UTF-16 LE with a BOM** — 244 KB for a file that is
122 KB as UTF-8. Written from PowerShell, whose `>` and `Out-File` default to UTF-16 on 5.1; the same
command from `cmd` produced correct UTF-8.

**Nothing catches it.** TypeScript reads the BOM and compiles happily, so `typecheck`, tests and the
build all pass. What breaks is every tool that assumes text: `grep` matches nothing, so a search for
a newly generated symbol comes back empty and reads as "the migration did not apply".

**After every regeneration:**

```bash
file src/types/database.ts        # want: ASCII text, not UTF-16
```

The repo command is `| Out-File -Encoding utf8`; a bare `>` in PowerShell is the trap.

**The second, harmless version of this: a UTF-8 BOM.** Re-running the command that same day gave
UTF-8 **with a BOM**, and the whole diff was three bytes on line 1 — `<EF BB BF>export type Json =`
— with the rest of the file byte-identical. That one is cosmetic: TypeScript strips it, git still
treats the file as text, `grep` still matches. It is worth recognising only so it is not mistaken
for the UTF-16 failure or for schema drift. `Out-File -Encoding utf8` writes a BOM on PowerShell
**5.1** and none on **7+**, where the BOM-less spelling is `utf8` and the opt-in is `utf8BOM`; a BOM
appearing therefore means the command ran under 5.1 *(inferred — the shell was not checked)*.

When the BOM is the *only* difference, there is nothing to commit:

```bash
git diff --stat src/types/database.ts   # 1 insertion, 1 deletion = BOM only
git checkout -- src/types/database.ts   # discard it; no regeneration needed
```

Committing it is safe but pointless, and guarantees the reverse one-line diff next time.

*Cost: a wrong diagnosis — the schema was assumed missing when it was present and unreadable.*


## A hand-written second copy of a list drifts, and type-checks all the way down

**Where it bit: three times in one day, 6 Sep.** Every instance is the same shape — a list that
lives in Postgres, copied by hand into TypeScript or into a migration, and then diverging with
nothing failing.

- **`notify-email`.** `notifications_type_check` admits sixteen types; the function's own
  `NotifType` union named nine. Seven types therefore reached
  `const copy = COPY[locale][row.type]`, found nothing, and returned `200 {skipped:'no_copy'}` — no
  error, no log line anybody reads, **no email**, and the notification still in the bell so it
  looked delivered. `cancelled` is raised from 28 places.
- **The audit triggers.** `20260802103000` attached `audit_row_change` to an array of 22 table
  names. Seventeen tenant-scoped tables were created afterwards and none was added, so every brief,
  template, concept and asset table built since August was unaudited **for a month**.
- **The audit screen's entity filter.** A hard-coded array of fourteen table names, which could not
  offer any of those seventeen even once they were audited.

**Why it is nasty, and the part that actually cost the time:** `COPY` is typed
`Record<Locale, Record<Exclude<NotifType,'due_soon'>, …>>`. That is a complete-looking map, the
compiler confirms it, and it proves nothing — it is checking the map against the copy of the list
that is wrong. I ticked the two tracker items closed on the strength of it and had to un-tick them
an hour later.

**The rule:** a list that exists in Postgres is read FROM Postgres, or a test reads the constraint
and asserts the copy against it — never a type over the copy. `src/test/notification-copy.test.ts`
does the first for the notification types; pgTAP `092` does it for the audit triggers by asking
`pg_trigger` which tenant-scoped tables lack one; `audit_event_entities` removes the third copy
entirely. **Prove such a test fails before trusting it** — delete one entry and watch, because a
regex that matches nothing makes every assertion in the file vacuously green.

*Cost: seven notification types silently emailing nobody for weeks, seventeen tables unaudited for a
month, and a wrong tick in `TASKS.md` inside the same session that was auditing it.*

---

## Spreading a task's hours is clamped to its span, and the office calendar is only a weekly pattern

**Where it bit:** 6 Sep, reported from the pilot — a task assigned Thursday for "2 days, 8 hours per
day" put all **16 hours on Thursday**.

`spreadHours` divides the task's TOTAL `sla_hours` by the working days it finds inside
`[starts_at, due_at]`. The span was Thursday–Friday; `workingDaysInRange` correctly dropped Friday
(all three offices are Sun–Thu), leaving one working day — and 16 / 1 = 16. **It compresses rather
than extending**, because nothing is allowed to move `due_at`, and Sunday is past it.

**The first diagnosis was wrong and worth recording as such:** the task form on `DeliverablesPage`
writes its single date field to BOTH `starts_at` and `due_at`, which looks like the cause and is
not — dates also arrive from the assignee's bookings through `app.sync_subtask_span`, so a span can
be expressed. Edward corrected it. The bug is the clamp, not the form.

**The larger fact underneath, which is still true after that is fixed:** the calendar is a repeating
weekly pattern and nothing else. `workingDaysInRange` takes a timezone and a list of ISO weekdays.
There is **no holidays table anywhere in the schema**, and it never consults
`resource_unavailability`, so a spread will place hours on Eid and on days somebody is on leave. The
booking dialog warns about both; the automatic spread cannot, because it is not given them.

Related and separate: `expandSeries` (multi-day bookings) steps **calendar** days with no reference
to the office week at all, so Thursday + 2 lands on Friday.

*Cost: a live mis-scheduling in the pilot, and an hour of diagnosis that blamed the wrong file
first.*

---

## A mutation that provisions rows must invalidate what it provisioned

`start_campaign_draft` inserts a campaign; the insert trigger provisions its **Working Files /
Deliverables / Final Assets / References** folders. The Brief Wizard had already read the client's
folder tree when the client was picked — *before any of those existed* — and nothing invalidated it.

**Symptom: the feature is simply absent.** Step 2 rendered no campaign filing panel at all. No
error, no empty state, no failed request — `campaignRoot()` searched a stale list, found nothing,
and the panel is conditional on finding something. Every test passed, because the wizard's suite
mocks the api layer and therefore has no cache to be stale.

The same shape bit twice in one afternoon: `app.provision_brand_folders` fires on a brand insert,
so registering a brand from the wizard had exactly the same defect.

**The rule.** Invalidate at the MUTATION, never at the call site. Provisioning is what the mutation
*did*; a caller that has to remember it is a caller that will forget — and the next caller never
knew. Both now do it in `useStartCampaignDraft` and `lib/brands.ts` respectively.

**Where to look when a panel is missing rather than broken:** anything conditional on a query
result that a recent write changed. `getQueryState(key)?.isInvalidated` is the assertion;
`src/features/campaigns/api/campaign-draft-api.test.ts` pins both cases, and both were verified by
removing the invalidation and watching them go red.

Postgres triggers make this easy to miss, because the provisioning is not visible at the call site
at all — the client sees one `insert` and has no idea four folders appeared.

*Cost: found in the browser by Edward, not by any suite.*

### A dialog that RE-DERIVES a value on open will write it back on save

`EditBookingDialog` seeds its date fields from the task, then recomputed where the task's days
"would" land — and rendered a notice saying the end date had moved. Edward opened a task he had
just dragged onto a Friday and was told it ends the following Sunday, which he correctly called
meaningless: the task ends on the Friday, because he put it there.

The visible symptom was a confusing message. **The real defect was one line further on:** the same
derived value fed the save, so pressing Save on a task you had only *looked at* would have written
the derived end date over the real one. Open a task, save it unchanged, and its dates move.

The distinction the code was missing: a **count** of days ("give this person 2 days") is turned into
dates and may legitimately slide; an **explicit placement** (a drag, or a date typed directly) IS the
answer and must not be recomputed. A dialog that opens on existing data is in the second case until
the person touches something. `datesTouched` is what separates them now.

*Cost: Edward had to ask twice — "I am unclear on what the purpose of the message is" — before the
save half was found. The message was a symptom; it was the only visible part of it.*

### An Edge Function 401 while the database call in the same click succeeds

Assigning a task created the task and then failed to schedule it: `POST .../subtask-schedule 401`,
"Sign in required". The RPC that created the task had gone through moments earlier on the same
session, which is what makes this confusing — it reads like a permissions or deployment problem, and
a deploy had just happened.

It was a stale session. PostgREST and an Edge Function do not validate the token by the same route
(the function builds its own client and calls `auth.getUser()`), so one can pass while the other
fails. **Sign out and back in before investigating anything else.**

It is worth ruling this out first because the failure is not free: the task IS created — the RPC
commits, and scheduling is a separate call — so a stale session leaves a real assigned task with no
bookings, and `I41.6` is that task being unreachable afterwards.

*Cost: most of an hour, a stranded task in the pilot data, and a wrong first answer from me. Not
caused by that day's deploy, but indistinguishable from it without checking.*

### The campaign wizard has no step reviewing tasks, and the tasks do not exist yet either

Tracing where a user declares a task's required inputs, I read all five steps of `BriefWizard`,
found nothing about tasks or dependencies anywhere in it, and concluded the capture step had never
been built. It had. I recommended building it, and Edward corrected me.

**Two separate facts make the wizard the wrong place to look, and neither is visible from it.**

Tasks do not exist while the wizard is open. They are materialised **server-side by a trigger** on
`deliverables` when a typed deliverable is inserted — `app.tg_deliverable_materialise_workflow`, in
`20260828220000_materialise_deliverable_workflow.sql`. That insert happens at submit on step 5, so
the tasks come into being *after* the last screen anybody sees. `apply_workflow_template` is not
called from the frontend at all; it is the manual path for an owner who wants a different template.

The review happens later and somewhere else: the **campaign page's department tabs**
(`CampaignPage.tsx`), where each deliverable has an "Open tasks" action that opens the same
`DeliverableDetail` the deliverables surface uses, carrying the **Required input** column
(`RequiredInput.tsx`, `requirements-api.ts`). It is gated on the campaign being approved and on the
caller being in write scope for that department — see `may_generate_department_brief`, which returns
`campaign_not_approved` rather than a boolean for exactly this reason.

**Why the obvious check misleads.** Counting rows in `sub_task_dependencies` returns 1 across the
whole tenant, which reads as "the capture mechanism is broken". It is not: the pilot is running on
ad-hoc tasks, which are individual by nature and have no siblings to depend on. The mechanism is
fine and the population is wrong.

**If you are looking for where a user declares something about a task, do not start at the wizard.**
The wizard creates campaigns, briefs and deliverables. Everything about *tasks* happens after
approval, on the department's own tab.

*Cost: a full investigation down the wrong path and a recommendation to build a feature that already
existed, retracted. The map had no row for "what a task is waiting for" — added in the same session.*

### Two migrations built in parallel each "reproduce" the same constraint, and the second wins

Five builders on five worktree branches, 11 Sep. Three of them added a notification type, and each
did the right thing by the rule in this file — reproduced `notifications_type_check` whole from its
LAST definition. The last definition was the same file for all three, so each migration carried the
base list plus its own type and none of the others. Applied in timestamp order, the second silently
dropped the first's type, the third dropped both, and `notification-copy.test.ts` — which reads the
last migration — saw only the third's list. Same shape for pgTAP suite numbers: four branches each
named their suite `097`, because each was the next free number on its branch.

**The rule "reproduce from the last definition" is correct and not sufficient when work is
parallel.** The integrator has to re-read every drop-and-recreate in the merged sequence and make
each one cumulative — the fix was to edit the later migrations so each carries the earlier ones'
values, not to add a fourth migration. Suite numbers are renumbered at integration. Both are now on
the integration checklist: `grep -l "drop constraint if exists" supabase/migrations/2026MMDD*` for
the day's migrations, and `ls supabase/tests | sort | uniq -d` on the number prefix.

*Cost: the merged tree passed every suite while un-emittable notification types sat in two
migrations — found only because the integrator diffed the three constraint lists by hand.*

### An RPC refuses correctly, and a bare PATCH on the same column succeeds

The adversarial reviewer's whole harvest on 11 Sep was one lesson four times: `approve_deliverable_tasks`
refused a team member and `update deliverables set tasks_approved_at = now()` did not;
`promote_single_job` refused out-of-scope and `update campaigns set kind = …` did not;
`sub_task_extension_request` refused a stranger and `insert into sla_events (… 'extension_requested' …)`
did not; `sub_task_approve` waited on optional answers and `update sub_tasks set status = 'done'`
did not. In each case the builder had written the rule into the RPC, tested the RPC's refusal, and
stopped — while the table's existing policy (`deliverables_tenant_write`, `campaigns_tenant_write`,
`sla_events_tenant_insert`, `sub_tasks_manage_update`) admitted the same actor to the same column.

ADR-0055 d.6 already says it: *an RPC is a front door; the policy decides.* The pattern that closes
it is the one this schema uses everywhere — a `BEFORE` trigger on the column that escapes on
`auth.uid() is null or app.is_system_op()` and on a GUC only the RPC sets
(`app.reviewer_verdict`, `app.extension_decide`, `app.task_list_approval`, `app.campaign_kind_change`,
`app.sla_event_writer`), plus a pgTAP `throws_ok` on the BARE write by an actor the policy admits.

**Every "server-written only" column and every "the RPC is the only route" sentence in an ADR is a
claim about the policy, not about the RPC.** When reviewing a migration, for each new rule ask:
which policy admits this actor to this table, and what stops them writing the column by hand?

*Cost: three MAJOR security findings on one branch, each with a verified exploit, each a
twenty-line trigger and a three-line test.*

### Two rows written in one transaction share `created_at`, and "the latest" is either of them

`sub_task_extension_request` supersedes a pending request by writing the old one's
`extension_withdrawn` and the new `extension_requested` in one call. Both default `created_at` to
`now()`, which is the transaction's start, so they are equal — and `order by created_at desc limit 1`
returns whichever Postgres feels like. The row read "withdrawn" while a request was pending, on
three surfaces, roughly half the time.

**`now()` is per transaction, not per statement.** Anything that writes two rows in one call and
later asks "which is newer" needs a second key — a rank on `event_type`, a sequence, or
`clock_timestamp()`. pgTAP cannot see this (one transaction, one `now()`, every row ties — test 099
already notes "the latest cannot be read off created_at here"), so it shows up only in the browser.

*Cost: a MAJOR review finding on the deadlines build; the fix was a tie-break in the reader.*

### Every `throws_ok` in a new pgTAP file reports "caught: no exception", and the trigger is provably right

Test 107, 11 Sep: five refusals asserted, none fired, while the same trigger refused the same write in
a hand-run probe. The file had no `begin;` before `select plan(...)`. Every other suite opens with
one, and it is not decoration: without a transaction, `set local role authenticated` is a WARNING
and a no-op, and `set_config(..., true)` (the `is_local` form every suite uses for the claims) is a
no-op too — so the whole file runs as the superuser with `auth.uid()` null, and every guard in this
schema escapes on exactly that. The refusals were not broken; they were never asked.

Both warnings are printed — `SET LOCAL can only be used in transaction blocks` — but pg_prove's
summary shows only the failed assertions, and the eye goes to those.

**A pgTAP file that begins with `select plan` and not `begin;` is testing nothing about
authorization.** Look for the `SET LOCAL` warning at the top of the output before reading a single
failed assertion; and if the throwaway container is used for a hand probe, remember that a
non-transactional run COMMITS the seed and poisons every run after it.

*Cost: a probe container, a polluted probe container, and half an hour, to find one missing word.*

### After `supabase db reset`, reads work but every write returns 403 / permission denied

12 Sep. A signed-in user's reads all worked; every write (registering a brand, saving anything)
returned `403 Forbidden` from PostgREST. Not RLS on the row — the caller's `has_permission` found
no grants at all.

**`supabase db reset` regenerates every role's id.** Roles are rows (ADR-0008) inserted with a
default `gen_random_uuid()`, so a reset gives them fresh ids. The browser's JWT, minted before the
reset, carries the OLD `app_role_id` in its claims. Reads pass because the select policies key off
`current_tenant_id()` (the tenant id is unchanged), but every WRITE calls
`app.has_permission(role_id, …)`, which looks up grants by the role id in the token — and that id
no longer exists, so it finds nothing and refuses.

**The fix is to sign out and back in** — a fresh token carries the new role id. It bites after every
local reset, and the symptom (reads fine, writes 403) points at RLS or grants, not at the session.
Confirm by decoding the JWT's `app_metadata.app_role_id` and comparing it with
`select role_id from user_profiles where id = <sub>` — a mismatch is this.

*Cost: half an hour reading brand-insert RLS and grants for a bug that was a stale login.*

### `create or replace view` fails with "cannot change name of view column"

13 Sep. A migration reproducing `campaign_list_rows` verbatim plus two new columns failed with
`cannot change name of view column "kind" to "deliverable_total"`. **`create or replace view` can
only APPEND columns at the end** — it matches the new select against the old one position by
position, so inserting a column before an existing one, or reordering, is read as *renaming* every
column after it and refused. The new columns had been added before `kind`; moving them to the very
end of the select list fixed it.

So when you add a column to an existing view via `create or replace`, it goes LAST, after every
column the view already has, regardless of where it reads best. To reorder, you must `drop view`
first (and then re-grant and re-point anything that depended on it). `verify.sh` catches this
immediately — it is a hard error on apply, not a silent one.

*Cost: one failed migration run; obvious once the error names the two columns.*

### A PostgREST embed named by column returns 400 PGRST200 "could not find a relationship"

12 Sep, the `/schedule` requested-chips query. The embed `resource:resources!resource_id(...)` 400'd
with `PGRST200 — Searched for a foreign key relationship between 'sub_task_assignment_requests' and
'resources' using the hint 'resource_id' … but no matches were found`. The FK is real — but it is
**composite**, the tenant fence `(tenant_id, resource_id) references resources(tenant_id, id)`, and
**PostgREST cannot resolve a composite FK from a single column-name hint.** A composite embed must be
hinted by the CONSTRAINT NAME (`resources!fk_sub_task_assignment_requests_resource(...)`); only a
single-column FK (`user_profiles!requested_by`) may be hinted by its column.

The code even carried a comment claiming composite keys are "hinted the same way" as single ones —
they are not. Unit tests never caught it: they mock the Supabase client, so the embed string is
asserted as text, never resolved by a real PostgREST. **Any query embedding through a `(tenant_id,
x_id)` fence by the `x_id` column alone will 400 the same way** — grep the schema for the constraint
name (`\d+ <table>` or `pg_get_constraintdef`) and hint by that.

*Cost: a 400 flooding the console on a working page, and the discovery that the embed had never once
run against a real PostgREST — only against mocks.*

### Every AI or email flow dead-ends locally — the receipt read, the brief fill, notifications

12 Sep, and it read as "bugs at every step": the receipt model-read returned `503 model_unconfigured`,
receipts fell back to `source=manual` with no filed screenshot, the SJ-03 brief fill did nothing, and
no email sent. One cause: **there was no `supabase/functions/.env`, so the Edge Functions runtime had
no `OPENAI_API_KEY` or `RESEND_API_KEY`.** `supabase functions serve` loads that file (or
`--env-file`); without it the AI/email functions have no secrets. The file is gitignored (it holds
secrets), so it does NOT travel with the repo, a worktree, or a fresh checkout — and it is not
recoverable afterwards: OpenAI shows a key once, and Supabase secrets are write-only (`supabase
secrets list` gives names + a hash, never the value). A lost key means a new key.

The tell: a function returns `model_unconfigured` / cannot send while the DB and auth work fine. Fix:
create `supabase/functions/.env` from `supabase/functions/.env.example` and **restart the serve so it
reloads** — an already-running serve does not pick up a newly-written env file. Production is
unaffected (its secrets are set on the hosted project and persist even when unreadable), so a
throwaway local key with a small cap is enough for local testing.

*Cost: hours of chasing individual "bugs" (blank clock, blank screenshot, manual fallback) that were
all one missing env file — and a search of every env file on disk to confirm the key was gone.*

### `supabase db reset` fails in the SEED and a fresh local database comes up empty

21 Sep. `Seeding data from supabase/seed.sql… ERROR: column "v_content" does not exist` — the
20 Sep edit that gives Northwind a written Content brief used a variable the second `do $seed$`
block never declared. Every migration had applied; the seed aborted; the database had no tenant,
no logins, nothing — and the walk's first step failed on a login that did not exist. The 20 Sep
reset had run BEFORE that edit, and the running database (which the edit was tested against by
inserting the row by hand) never told anyone.

**A seed edit is proved by a `db reset`, not by the database you are looking at.** The seed is
only ever executed from empty; the running stack has already passed it. Fixed as `I53.17`.

*Cost: one empty database and a failed walk before the seed was read.*

### One vitest test fails in the full run and passes every other way

*22 Sep, merging a branch into another. `npm test`: 2363 of 2364. The failing test passed on its own,
passed with its whole file, and passed with `--no-file-parallelism` — the full suite, serially, was
green.*

**It was never about the merge.** The assertion read a value the component sets inside a mutation's
`onSuccess` — the test waited for the mutation to be CALLED and then read the address synchronously.
Under parallel load the success handler had not run yet. The merge added seven tests, which shifted
the scheduling enough to expose it; the bug had been there since the test was written.

**The diagnosis is the two runs:** passes alone AND passes with `--no-file-parallelism`, fails in the
default run → a timing assumption in the test, not a regression in the code. The fix is to wait for
the thing you are actually asserting (`await waitFor(() => expect(...))`), never to serialise the
suite.

### CI fails on the step AFTER the one you just fixed, on tests that pass locally

`ci.yml` runs its steps in order and stops at the first failure, so a branch whose Deno check has
been red for days has **never run the unit-test step** on CI. Fix the Deno check and the next push
fails on unit tests instead — which reads as "worse", and is not: it is the first time that step ran.

The specific failure on 14 Sep: `src/lib/env.ts` parses `VITE_SUPABASE_URL` and the publishable key
at module load and throws when they are absent, which is CI (no `.env`). Anything importing a module
that imports `env` — the auth layout, the environment banner, `env.test.ts` itself — failed there
and passed on every laptop. `vitest.config.ts` now sets the two values to the local stack's, so
tests never depend on a `.env`. Hide your own `.env` and run `npm test` to reproduce CI.

*Cost: one red CI run and a fright, after a green one had been expected.*

### `vitest run` on one suite prints nothing and never returns

**Symptom.** A single component suite hangs at start-up — no test names, no failure, no output at all
— and stays hung past the 5-minute timeout. Nothing in the diff looks like a loop.

**Cause.** A component syncs a draft from a query with `useEffect(() => { if (data) setDraft(data) },
[data])`, and the test's `vi.mock` returns the hook as `() => ({ data: { … } })` — a **fresh object
literal on every render**. Real react-query hands back a structurally-stable `data`, so the effect
fires once. The mock fires it on every render, `setDraft` re-renders, the mock builds a new object,
the effect fires again: an infinite render loop inside jsdom, which never throws and never prints.

**Fix.** Hoist the mocked `data` to one constant — inside `vi.hoisted(...)`, because the mock
factory is hoisted above every top-level `const` and a plain one reads as "cannot access before
initialization". `OrganizationPage.test.tsx` (the scheduling-rules section) is the precedent.

*Cost: ~10 minutes and two killed node processes, on 13 Sep. The tell is the SILENCE — a genuine
test failure always prints.*

---

### A `grep … | grep -v test` count of buttons, links or props is far too low

14 Sep, the reusable-buttons sweep: `grep -rn "<button" src | grep -v test` said 31 raw buttons
were left; the true number was 81. `-v test` was meant to drop `*.test.tsx` files, but it drops
every LINE containing "test" — and almost every interactive element in this codebase carries a
`data-testid`. The sweep was nearly declared complete with fifty buttons untouched, every dialog's
submit among them.

Exclude test files by path (`grep -v "\.test\.tsx"`, or `--glob '!**/*.test.tsx'` in ripgrep),
never by the word. The same mistake hides in any count of `onClick`, `aria-label` or `className`.

*Cost: a second full pass, found only because a screenshot showed grey browser-default buttons the
count said did not exist.*

## Browser tests (Playwright, local stack)

### A spec passes alone and fails in the full run, or `locator.click: Test ended` on a Save button

Three shapes, all from the local database being long-lived across runs (`docs/E2E-PLAN.md`):

- **A step depends on an earlier step in the same file** (I4 asks for time on the task I2 booked).
  Run the section whole; `-g` on one test fails for a reason that is not a regression.
- **A notification assertion matches the previous run's row.** `waitForNotification` returns the
  newest of that type for that person; on a database that has seen ten runs that is not this run's.
  Pass the `entityId`.
- **`locator.click: Test ended` on `scheduling-settings-save`** (or any form whose Save is off until
  something changes): the value was already what the test "set" it to, so nothing was touched, Save
  stayed disabled, and the click waited out the test's clock. Read the field first and skip the save
  when it already holds the value. Same family: a leftover closure or setting from a failed run
  changes the arithmetic the next run reads — put the organisation back at the START of the test,
  not only at the end.

- **`locator.click: Test ended` on the page's SECOND write** (16 Sep, `notifications.spec`): since
  15 Sep every write on the deliverables page answers with a "Done" dialog in front of it
  (ADR-0092 d.2), and a spec older than that never closes it — the next click waits behind the
  backdrop until the clock runs out. Close it (`deliverables-banner-close`; the coverage specs'
  `done()` helper) after every save. Its leftover: the test dies before its clean-up step, the
  fixture keeps the changed owner, and every later run reassigns nothing, matches the OLD
  notification (already read) and fails on the badge — which read, for an hour, as "notifications
  are being marked read a second after they are written". They were: by the previous run's click.
  **Before naming a writer, prove it** — a temporary `after update` trigger logging
  `request.jwt.claims ->> 'sub'` and `current_query()` into a scratch table settles it in one run.

- **A "may not" that was true only on the old database** (17 Sep, first run after the 16 Sep
  reset): *SLA profiles* expected "already has a default" and got "saved" — the seed carries no SLA
  profile; the 15 Sep database happened to hold one. *Chat* waited on `chat-archived-toggle`, which
  renders only when something in reach is archived — nothing was. Neither spec had ever made its
  own premise. A refusal or a hidden control needs the state that causes it, made by the test (the
  first default; an archived job). The reverse also holds: a fixture that exists only because an
  earlier run left it is a pass that will not survive `db reset`.

Also: Playwright restarts the worker after a failure and **re-runs `beforeAll`**, so one failure
makes every later test in the file run on fresh fixtures — the cascade is not real failures.

*Cost: four or five reruns across K7, M1 and M3 before the pattern was named; an hour on 16 Sep
chasing a phantom notification bug.*

### A full run wrote 123 notifications and Mailpit holds 13 — the slow lane looks broken

It is not. The specs call `clearMailbox()` between steps, so a full run wipes its own evidence and
only the mails sent after the LAST clear survive. `net._http_response` is where to look: every
`notify-email` call answered `{"sent":true,"resendId":…}` — under `EMAIL_TRANSPORT=mailpit` the
"resendId" is Mailpit's own message id, so a sent:true with 13 in the inbox means cleared, not
lost. To see every mail as sent, do not run the suite for it: pick one `notifications` row per
type (they all survive in the database) and POST `{ id }` to `/functions/v1/notify-email` with the
Vault bearer (`notify_email_bearer`) — the same call the trigger makes — into an untouched mailbox.
`docs/reference/notification-emails-as-sent.md` is produced that way (17 Sep).

*Cost: half an hour on 17 Sep reading pg_net responses for a delivery fault that did not exist.*

### After `supabase db reset` every page says "Couldn't load your permissions", for every persona

**Symptom (16 Sep):** two coverage specs red straight after a `db reset`, both before their first
real step; the page snapshot shows *Couldn't load your permissions — you are still signed in*. The
same RPCs answer fine from `curl` with a fresh token.

**Cause:** `e2e/local/auth.setup.ts` reuses `e2e/.auth/<persona>.json` for an hour. A reset
invalidates every refresh token those files hold; the access token still parses, the first refresh
fails, and every read then runs as nobody. The hour-long reuse was itself a fix for the opposite
problem (15 Sep, rotated refresh tokens), so it is not wrong — it just does not know about resets.

**Rule:** `rm -rf e2e/.auth` after every `supabase db reset`, before the first Playwright run.

*Cost: three reruns and a red herring (PostgREST schema cache) before the auth files were suspected.*

### A Node script driving the app opens `http://localhost:5173C:/Program Files/Git/…`, or a `fullPage` screenshot shows one screen

Two things that bit the screenshot walk for `docs/guides/` (14 Sep), both invisible from the error:

- **Git Bash rewrites any argument that starts with `/`** as a Windows path before Node sees it:
  `node walk.mjs /campaigns` arrives as `C:/Program Files/Git/campaigns`, and Playwright dutifully
  navigates to `http://localhost:5173C:/Program Files/Git/campaigns`. Prefix the command with
  `MSYS_NO_PATHCONV=1`, or pass route names without the leading slash and add it in the script.
  (A Playwright *spec* run through `npx playwright test` is unaffected — the paths are in the file.)
- **`page.screenshot({ fullPage: true })` captures the viewport and nothing more**, because the
  document does not scroll — `.shell-main` does (`.shell` is locked to `100vh`, `overflow: hidden`).
  For a whole-page capture inject a style that lets the document scroll (`.shell { block-size:
  auto; overflow: visible } .shell-main { overflow: visible }`) before the shot, and remove it after.
  Fixed modals are a third case: they clip at the viewport, so make the viewport taller for those.

*Cost: three reruns and two puzzled screenshots before either cause was visible.*

### A booking "could not be made" but the task IS assigned — and every Edge Function answers 503 "name resolution failed"

15 Sep, the guide walk after a Docker Desktop restart: `+ Book` reported *"The booking could not be
made. Nothing was booked"*, yet the task had an assignee and its reviewers — and no booking row.
`subtask-schedule` (the Edge Function that turns the assignment into bookings) answered
`503 {"message":"name resolution failed"}`. The `supabase functions serve --env-file …` process
from the previous session had died with the restart, so the functions were being served by the
bare edge-runtime container from `supabase start`, which cannot resolve the API host and has no env
file. The assignment RPC succeeded; the scheduling call after it did not; the dialog reported the
whole thing as failed.

Restart `supabase functions serve --env-file supabase/functions/.env` (RETEST-REDESIGN.md's own
first step) and it works. Symptom to remember: **assigned but no chip on the grid** after any
Docker restart. The half-assigned tasks need the assignee cleared by hand to re-book.

*Cost: three reruns chasing "two reviewers" as the cause before the 503 was captured.*

## A page says "Could not load" for one busy person and nobody else

**Symptom:** My Work opened for everyone except the person with the most tasks, for whom it said
*Could not load your assigned work* — no error report, nothing in the function logs, and the same
person's tasks readable one by one.

**Cause:** a follow-up read named every task id in ONE request's address —
`.in('sub_task_id', [...230 ids])` — and at ~9 KB Kong answered `414 URI Too Long` before PostgREST
ever saw it. The database was never asked. Four reads had the shape (reviewers, extension events,
pending assignment requests, dependencies); the first to run failed the page.

**Cost:** an afternoon's confusion during the I49 burn-down (15 Sep) — the seeded maker had crossed
the line after two days of runs and every My Work test started failing for "no reason".

**Rule:** an id list never goes into a URL whole. `src/lib/query/in-chunks.ts` batches it (100 per
request); use it for any `.in(column, ids)` whose list is unbounded. Do NOT reach for an embed
instead — over a composite key an embed comes back silently empty (the trap two entries up).

## A session reports "typecheck clean" and CI fails on the first push

**Symptom:** eight fixes in a row were reported with "typecheck and lint clean"; the push failed
Vercel's `npm run build` and the CI typecheck on one `TS18046` in a unit test (16 Sep).

**Cause:** the checks were `npm run typecheck 2>&1 | grep -c "error TS"`, and `tsc` colours its
output when it thinks it has a terminal — the text is `[91merror[0m[90m TS18046`, which the grep
does not match. The count read 0 with one real error present. The first check of the day had been
read by eye and was right; the seven that followed trusted the number.

**Cost:** a failed deploy, a failed CI run, and — worse — a run of verification claims Edward had
no way to tell from real ones.

**Rule:** a "passes" claim is the command's EXIT CODE (`npm run typecheck > /dev/null; echo $?`)
or a count line read from the tool's own summary (`Tests  2224 passed`, `Result: PASS`,
`Found 0 errors`). Never a grep over output that may be coloured, and never a count of matches.
`scripts/db/verify.sh` and vitest print summaries; `tsc -b` prints nothing on success — its exit
code is the only answer.

## A list on production never updates — "users are submitting for review without pressing Start", or a second tab keeps an old count for ever

**Symptom:** a lead on production (17 Sep) reported tasks in review that nobody had started, and a
campaign page left open in a second tab kept the old task count indefinitely after a task was added
elsewhere. Read as a rule bypass; the database was checked first.

**Cause:** nothing bypassed anything — the only submit door refuses an unstarted task. The screen
was stale: `src/main.tsx` sets `staleTime: 30_000` and `refetchOnWindowFocus: false` for EVERY query,
so a list that nothing on that page invalidates is re-read only on navigation. The campaign page's
deliverables, the Deliverables page's task list, My Work, Awaiting review and the ad-hoc list all had
that shape. (A direct call to `app.sub_task_submit` COULD put a `todo` task in review when manual
minutes were supplied — closed the same day, `20260917130000`.)

**Cost:** a production report investigated as a status-machine hole; the first reproduction went
to the wrong layer. (Derived from the 17 Sep tracker entries `I52.9`/`I52.15`; not lived in this
session.)

**Rule:** a list that OTHER people change while it is open must opt in: `refetchOnWindowFocus: true`
+ `refetchInterval: 20_000` on the hook (`campaign-detail-api.ts`, `deliverables-api.ts` show the
shape). When a user says "it is not updating", check the hook's options before the database. And a
browser test that opens the page in a second context and waits for the count is the proof
(`coverage/campaign-rings.spec.ts`).

## "This was working yesterday" — a change on the client stopped reaching its campaigns, and no code changed on that path

**Symptom:** changing a client's account manager used to move its campaigns to the new manager;
on 17 Sep it stopped, and `git log` showed nothing touching the propagation.

**Cause:** there never was a propagation — only a FALLBACK. Campaigns carried no manager of their own
until ADR-0073 d.5 made the wizard's field required, so `coalesce(campaign, client)` applied to every
row and looked like a live link. Once every new row carried its own value the fallback never fired
again. The behaviour was an accident of empty columns, and filling the column "broke" it.

**Cost:** half an evening (17 Sep) reading a path that had not changed. (Derived from the `I52.19`
tracker entry.)

**Rule:** when a behaviour "stops" with no change on its path, ask whether it ever had a mechanism or
only a default — a fallback stops the day the column is filled. The real link is now a trigger,
`app.tg_client_account_manager_propagates` (`20260917160000`); a fallback that a feature depends on
deserves one too, or a note saying it is a default.

## A new table answers `permission denied` on the local stack though its RLS and pgTAP are fine

**Symptom:** the first browser test against a new table (20 Sep, `campaign_phases`) failed with
*"Could not create the campaign"*; Postgres logged `permission denied for table campaign_phases`.
`verify.sh` had passed every suite on the same migration minutes before.

**Cause:** the migrations never grant TABLE privileges (`I43.2`); `verify.sh` masks it because
`scripts/db/local-stub.sql` sets default privileges before the migrations run, and the seed's
blanket grant covers only tables that exist when the seed runs. A table created afterwards by
`migration up` has no key at all — RLS is never consulted.

**Cost:** twenty minutes and one full spec run, reading the migration for an RLS gap it did not have.

**Rule:** every migration that creates a table grants `select, insert, update, delete … to
authenticated, service_role` in the same file (`20260913190000` and `20260920100000` are the
shape), and says so. On a running local stack, apply the grant by hand as well — `migration up`
does not re-run the seed.

**25 Sep, again — for the SERVICE ROLE too.** Six I59 tables (`tenant_escalation_rules`, `tenant_filler_words`,
`escalation_log`, `escalation_unreached`, `deliverable_change_requests`, `piece_messages`) were refused 42501 to the
browser suite's service-role reads and to the escalation sweep; `20260926151000` / `152000` grant them. Grant
`authenticated` AND `service_role` in the migration that creates the table.

## A Playwright test runs for its whole 15-minute timeout on a line that should have failed at once

21 Sep, the inspection walk. `locator.first().dispatchEvent('mousedown')` on an option list that
had no options (the picker did not know the Arabic name — `I53.23`) waited for the option to
appear — for the test's full timeout — because `playwright.local.config.ts` sets no
`actionTimeout`, and Playwright's default is **0 = unlimited**. Same shape: `textContent()` on a
panel that rightly does not exist. A "should fail now" line becomes a 15-minute hang, and a
15-test walk looks like it has crashed.

Two rules. **A long spec sets `test.use({ actionTimeout: 15_000 })`** — an action is a few
hundred milliseconds; fifteen seconds is generous, fifteen minutes is a hang. And **never
auto-wait on something whose absence is the correct state**: `count()` first, then read.

*Cost: two fifteen-minute waits, one per shape, before either was named.*

## A coverage spec fails on mail or the model mid-session, and the function log says "File change detected"

**Symptom:** a spec that had passed failed on a Mailpit assertion (no mail within 20 s) with
`notify-email` requests visible in the function log seconds earlier; the next run passed unchanged.

**Cause:** `supabase functions serve` watches the tree and RESTARTS the whole runtime on any file
change under `supabase/` — an edit to a migration or a test file while a spec is mid-flight drops
the `pg_net` call that was in progress, and nothing retries it. The log line is *"File change
detected: … Setting up Edge Functions runtime…"*.

**Cost:** one confusing rerun and a false lead about the email queue.

**Rule:** do not edit anything under `supabase/` while a browser run is going; if a mail or model
assertion fails once, check the function log for the restart line before reading the code.

**28 Sep, worse:** the restart can fail outright — *"Conflict. The container name
"/supabase_edge_runtime_maestro-local" is already in use"* — and the process exits, so every function
answers 503 for the REST of the run. `supabase db reset --local` also takes `functions serve` down. After either:
`docker rm -f supabase_edge_runtime_maestro-local`, start `functions serve` again, and wait for an
`OPTIONS …/functions/v1/notify-email` to answer 405 (502/503 is still starting) before the first spec.

## An `after update of <column>` trigger never runs, though the column visibly changed

22 Sep, `I53.29`. `after update of department_id on deliverables` was written to move a deliverable's tasks when its department changed. pgTAP 140 changed the OWNER, the BEFORE trigger set the department from the owner, the row showed the new department — and the AFTER trigger never fired.

**`update of <column>` tests the columns the STATEMENT named, not the columns that changed.** A column a BEFORE trigger sets is not in the statement's target list, so a trigger keyed on it alone is never called. Key the trigger on the column the user actually writes (here `owner_user_id`, and `department_id` too for a direct write) and compare old and new in the function body.

*Cost: one failing suite and a hand probe before the cause was named.*

## A migration re-emitted from `pg_get_functiondef` fails at `$function$`, or its every line is doubled with blank ones

22 Sep, `I53.30`. The live `update_task_assignment` was dumped with `pg_get_functiondef` through `psql` on Windows to be re-emitted with one block changed. The dump had `
` on every line (psql adds CRLF to text that already carried CR), so the file read double-spaced; and `pg_get_functiondef` ends at `$function$` with **no trailing `;`**, so the migration failed on the statement after it.

**Normalise `
` → `
` and add the `;` before anything else is done to the dump.** Then reproduce the header in the house shape (`create or replace … language plpgsql security definer set search_path = …`).

*Cost: two failed applies before the missing character was seen.*

## `supabase db push` sits there for ever and the database shows nothing blocked

22 Sep, `20260922120000`. The push printed the migration's name and never returned. `pg_stat_activity` showed no lock wait and nothing running — because it had already finished: `supabase_migrations.schema_migrations` held the version and the new function body was live. The CLI hung on its way OUT, not on the way in.

**Before killing or re-running a stuck push, ask the database whether the version is recorded** (`select 1 from supabase_migrations.schema_migrations where version = '…'`) and whether the change is visible (a `comment on function` that names the migration makes this a one-line check). A migration is one transaction: either both are true or neither is, and re-running an applied version is refused, not repeated.

*Cost: one diagnostic round on production with Edward at the keyboard.*

---

## A button does nothing at all — no error, no navigation, and the handler looks right

24 Sep. Next on the wizard's timing step did nothing: no refusal dialog, no step change, the button
not disabled, the handler plainly correct. Twenty minutes went on the mutation mocks, because a save
that never calls back looks exactly like this.

The cause was a **temporal dead zone**. `stepValid` is a hoisted `function`, so it can be called from
anywhere in the component; it had started calling `dueDateOf`, which is a `const` arrow declared two
hundred lines further down. React's render reached `stepValid` first, the `const` was not initialised
yet, and the whole render threw. Vitest reported it as an *unhandled error* attributed to the test
FILE rather than as a test failure, so the suite showed "cannot find element" and said nothing about
the throw.

**A hoisted `function` may be defined anywhere; the `const`s it closes over may not.** When a helper
starts reading a new value, move the value above every caller, or make it a `function` too. And when
a UI does nothing with no error on screen, look for an unhandled error in the runner's output before
looking at the handler — vitest prints them under `Unhandled Errors`, well below the failure.

*Cost: ~20 minutes, and two wrong fixes to test mocks that were never broken.*

---

## Every spec times out on a page that loads fine by hand, and the screenshot is somebody else's app

24 Sep. Every Playwright run failed waiting for `locale-toggle`, and `curl localhost:5173` answered
200. The failure screenshot showed a **different product's 404 page** — a Vite dev server from
another repo on the same machine had taken port 5173 after Maestro's was restarted.

`playwright.local.config.ts` has `webServer.reuseExistingServer: true`. It probes
`http://localhost:5173`, gets a 200 from whatever is listening, and reuses it. Nothing checks that
the thing answering is this application.

**Read the failure screenshot before the stack trace**, and if a port is suspect ask who owns it:
`netstat -ano | grep :5173` then `Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>'` prints the
command line, which names the repo. The fix is not to kill the other project: start this one on a
free port and pass `E2E_BASE_URL=http://localhost:<port>` — `use.baseURL` honours it even though
`webServer.url` does not.

*Cost: two full walk runs and a wrong diagnosis of a stale module cache.*

---

## A walk passes end to end and never reached the end

24 Sep, and the one that cost trust rather than time. The campaign walk was written with
`if (await x.isVisible()) { shoot } else { walk.note('refused; photographed instead') }` at the last
two steps, so that a refusal would still produce a report. It reported **21 passed**. It had never
got past step 3 in either language: a proposed piece had no owner, the step refused exactly as it
should, and the walk photographed the refusal and carried on. The HTML report was then described to
Edward as showing the last two screens.

**A walk with a fallback is not a test.** Every step must be a hard assertion, so that a refusal
fails the run. Where a step legitimately needs the walk to DO something first — own every piece, give
every piece a phase — write that as a helper that loops until the blocker is gone and throws if it
cannot, never as a branch that skips it.

And before reporting a walk: read `report.json`, not the exit code. Check that the last chapter has
the screenshots it should and that the checks are the ones you meant to make. A green run proves the
script finished, not that it saw anything.

*Cost: a day of Edward's trust, and a report that had to be withdrawn and re-shot.*

---

## A pgTAP file you only reworded stops with `syntax error at or near "select"` and `Bad plan`

24 Sep. Eight suites were rewritten to ADR-0102 by a Node script (`s.replace(old, new)`), and two of
them then died mid-file: `ERROR: syntax error at or near "select"`, `Parse errors: Bad plan. You
planned 8 tests but ran 2`. The edited lines read correctly in the script. In the FILE, every
`$$, 'message');` closing a `results_eq($$ … $$, …)` had become `$, 'message');`.

**In a JavaScript replacement string `$$` means one literal `$`** (`$&`, `$1` and `$'` are special
too). SQL test files are full of `$$`, so any `String.replace` whose NEW text contains dollar-quoting
silently eats half of each pair; the statement never closes and the next `select` is a syntax error.
Pass a function instead — `s.replace(old, () => replacement)` — or use `split(old).join(new)`, or the
Edit tool. Check afterwards: `grep -n "^\$, '" supabase/tests/*.sql` should find nothing.

*Cost: a full `verify.sh` run and twenty minutes reading SQL that looked right.*

---

## A page scrolls sideways on a phone though its wide table sits in its own scrolling box

24 Sep, the campaign Grid at 390 wide: `document.scrollWidth` was 1119 while `body`, and every
ancestor of the 1,100-px table, measured 390 — the table's `.grid-scroll` wrapper had
`overflow-x: auto` and did its job. The culprit was the header's `.sr-only` "Actions" label:
**absolutely positioned, with no positioned ancestor below the page**, so its containing block was
the page, its static position sat at the far end of the table, and an `overflow` box that is not its
containing block does not clip it.

Fix: `position: relative` on the scrolling box, which makes it the containing block. To find the
next one, list what lies past the edge whose PARENT does not, and look for `position: absolute` among
them — a plain "which element is wider than the screen" walk stops at the table and misses it.

*Cost: three probe scripts and a wrong theory about the table.*

---

## A walk's RPC checks all fail `401 JWT expired` while its screens work

25 Sep, the job-to-campaign walk. Every check that called an RPC directly (`assignable_deliverables`)
failed `PGRST303 JWT expired`, while every browser step in the same run passed. The walk read the
person's token out of the saved login (`e2e/.auth/*.json`), and runs with `--no-deps` skip the setup
project that writes those files — so the token is whatever the last setup wrote, and it lives an
hour. The browser refreshes its own session; a token lifted from the file does not.

**A spec that calls the database as a person signs in for a fresh token** (`/auth/v1/token?grant_type=password`
with the seed's `devpassword`) — see `tokenOf` in `e2e/local/coverage/reopen.spec.ts`. Reading the
storage state is only safe straight after the setup project ran.

*Cost: one full walk run whose five schedule checks were all false failures.*

## A mail check counts mail to people the step never touched

25 Sep. The walk's "exactly one mail, to the owner" checks found four or seven mails — to the Motion,
Edit and Copy leads — though the step touched none of them. A second Playwright run (the guide spec)
was sending mail into the same Mailpit at the same time. Mail checks read the WHOLE box and empty it
after, so two runs make each other's checks wrong, and each other's boxes empty.

**A spec or walk that asserts on mail runs alone.** Parallel runs are fine only when neither reads
Mailpit. The job-to-campaign walk says so in its header.

*Cost: one ten-minute walk run to re-do.*

## English specs fail on words after a walk — the pages come up in Arabic

25 Sep. After the job-to-campaign walk's Arabic half, ordinary English specs failed on text they had
always found. The language choice is REMEMBERED on the profile (`user_profiles.locale`, I53.21), and
the Arabic half switches every seeded person it signs in as — 27 of them — so the next run opened in
Arabic. Nothing in the failure mentions language; the screenshot does.

**A walk that switches the language puts it back** — the job-to-campaign walk now resets every seeded
person to their seed locale in `afterAll` (`animator` is Arabic on purpose). `section-d` and
`campaign-flow` walk in Arabic too and do not yet do this. To repair by hand: set `locale = 'en'` on
the seeded profiles, `animator` excepted.

*Cost: a background agent's debugging time, found while fixing I57.*

## `check:e2e-coverage` says a control is covered, and no spec ever pressed it

25 Sep. The gate matches a spec's test id to a control by SHAPE, both ways: a control written as
`${testId}-remove` is the shape `*-remove`, and pressing ANY `something-remove` in any spec covers
it — every dialog's Remove at once. Same for `*-save`, `*-cancel`, `*-edit`. The old job-to-campaign
walk "covered" a brief's Re-open that no screen could reach, through a branch that never ran.

**Covered by the gate is not tested.** When adding coverage, press the control's own full id
(`wizard-phase-dialog-remove`, not whichever `*-remove` is nearest) and assert what it did. Shapes the
gate thinks too vague to count are listed at the top of its report.

*Cost: a dead Re-open (I57.40) sat unnoticed behind a green gate.*

## A list quietly ends — the newest items are missing and nothing errors

25 Sep. PostgREST returns at most `max_rows` (1,000, `supabase/config.toml`; the hosted project the same) per
request and says nothing about the rest. A department lead's chat list (2,154 conversations) lost its newest
job; the campaigns list (1,056) lost a pending job; the Schedule's 4-week bookings (1,351) and the team view's
unassigned tasks (4,921) were short; booking-transition's capacity check could miss bookings past row 1,000.
**Any list read without `.range()` is capped** — an RPC returning a set too. Page with
`src/lib/query/all-pages.ts` (`allRows`, `inChunksPaged`) in the app and `supabase/functions/_shared/all-pages.ts`
in the functions (a copy — `I59.40a`); a count is `{ count: 'exact', head: true }`, never rows counted.

*Cost: found only because the long-lived local database had grown past 1,000; I59.35 and I59.39 paged 39 reads.*

## A helper's worktree has none of the branch's recent work

25 Sep. The Agent tool's `isolation: worktree` copies start from the repository's DEFAULT branch (main), not the
branch you are on — four parallel helpers began on `4389207` (main), 32 commits and 27 migrations behind
`running-it`, and one could not find section D's files. Uncommitted work is never in any worktree either.
**Create the copies yourself:** `git worktree add --detach .claude/worktrees/<name> <branch>`, copy the
uncommitted files in, junction `node_modules` to the main checkout's, and brief the helper to work only under
that path; merge back by three-way `git merge-file` against the copy's base, with line endings normalised (the
copies check out CRLF, the main checkout is LF). Remove the junction BEFORE `git worktree remove`.

*Cost: four helpers stopped and restarted; one later merge overwrote a track's files with its older snapshot.*

## Specs pass on the long-lived local database and fail after a reset

26 Sep. Months of test runs left 1,056 campaigns, thousands of tasks and ~250 live tasks on Dev Maker; the
walk's maker page was 37,000px tall and specs quietly relied on the clutter. After `supabase db reset --local`
six specs failed — and two were PRODUCT bugs the clutter had hidden: new tenants got no languages
(`20260923230000` seeded existing tenants only — fixed in tenant setup, `20260926180000`) and the audit log's
More (next entry). **Before a walk or a final browser run, reset**; a spec must create what it needs, and
reference data a real tenant has belongs in tenant setup or the seed, readable names only (Edward, 26 Sep).

*Cost: a full reset + suite round, and an unreadable review report.*

## "More" loads nothing though there are more rows

26 Sep. The audit log paged by `created_at < last` alone. One transaction stamps all its rows with the same
time — setting up a tenant writes ~2,171 audit rows at one instant — so page two came back empty. Page by
(time, id), never time alone (`src/features/admin/api/roles-api.ts`, I59.38).

*Cost: surfaced only on a fresh database.*

## Every single-job release is refused: "InheritedRules still says '[]'"

25 Sep. E10 made the filler check read "every field with text" — and a single job's `campaign_briefs.values` also
holds keys no person types (`inheritedRules`, the rules snapshot, stored as the string `[]`, which has no
letters and so reads as filler). **"Every field" means the TEMPLATE's fields**: `app.campaign_brief_filler` joins
the template's field list (`20260926151000`; pgTAP 173 holds it).

*Cost: 54 browser failures in one run, all cascading from the release step.*

## The whole tracker shows as changed after a one-line edit

25 Sep. `docs/TASKS.md` is stored with CRLF; `sed -i` in Git Bash rewrote it LF and `git diff --stat` showed
~13,000 changed lines. Edit it with the Edit tool (it keeps the endings), or convert back, and check
`git diff --ignore-cr-at-eol --stat` shows only your lines.

*Cost: a scare over what else had changed.*

### `supabase db push` would stop on a NOT NULL that passed every local check

26 Sep, the release. `20260923140000` set `deliverables.owner_user_id` / `department_id` NOT NULL with the
note *"0 of 293 rows"* — counted on the LOCAL database, which is reset and holds only work newer than the
rule. Production held 100 ad-hoc/internal deliverables with neither (legacy, before 29 Aug), so the push would
have stopped there. A later migration dropped both again anyway, so the two lines were removed from the
un-pushed file (I59.50). **Before any push that adds NOT NULL, a unique index or a constraint on an existing
table, have Edward run the count on PRODUCTION**; a count taken locally proves nothing about live data.

*Cost: caught only because the pre-push query was run; otherwise a half-applied release.*

### `db push` says local migrations must be "inserted before the last migration on remote"

26 Sep. Production already had `20260922190000` (merged on its own) while six older-stamped migrations sat on
the release branch. The CLI refuses and asks for `--include-all`, which applies them out of order. It is safe
only if none of them re-creates a function, trigger, policy, view or rule the newer one changed — check that
overlap first (it was empty). The CLI's confirmation list also printed two migrations twice; they applied once.

*Cost: a stop mid-release and an audit of 65 files.*

### A walk's "every mail has its notification" check fails with the notification right there

26 Sep. The walk stamped its start with THIS machine's clock and compared it with `notifications.created_at`,
which is the DATABASE's. The local Docker clock ran 5.4 s behind, so a notification raised in the walk's first
seconds read as earlier than the start. Compare `select now()` with the host before trusting a time window; the
job-to-campaign walk now allows a minute and matches the mail's subject to the notification's label.

*Cost: a red check with the row in plain sight.*

### A walk's set-up fails on a second run: "A campaign with this name already exists"

26 Sep. The running-the-week walk builds its story under fixed names (Northwind Autumn Push, Autumn social set,
Store static for tomorrow, Eid store window poster, Price list reprint) and is written for a freshly reset
database. Run twice, set-up is refused; run after other walks, a single-job step hits the duplicate title first
and the similar-job prompt it expects never comes. Reset the database, or rename the leftovers out of the way.

*Cost: three re-runs before the cause was plain.*

### A step fails with a 15-second timeout on a dialog it never waited for

26 Sep. `Promise.race([promptVisible, reviewVisible])`: the loser keeps waiting, and when its 15 s timeout
fires it rejects into whatever step is running by then — so a later, healthy step fails at random, depending on
data and timing. Use `Promise.any` (settles on the first to happen, still fails when neither does). Fixed in the
walks and `helpers/single-job.ts`; 20 more in `coverage/` and `retest-redesign/` (I59.48, on hold). Related:
Playwright's `isVisible({ timeout })` does NOT wait — use `waitFor({ state: 'visible', timeout })`.

*Cost: a walk red for a reason in no screenshot.*

### A save's success message says the opposite of what was just done

26 Sep, the Organization page's production switch. The checkbox is controlled by the SAVED value, so after
the click React puts it back until the refetch lands; `onSuccess` read `e.target.checked` by then and got the old
value — the notices were reversed. Take the new value once, in the handler (`const next = !current`), and word
everything from that.

*Cost: shipped, and found by Edward on the first click.*

### The dev server serves a blank page after a branch switch — requests 504 "Outdated Optimize Dep"

26 Sep. Vite's pre-bundled dependency cache went stale when the branch (and `node_modules`) changed under a
running `npm run dev`; every module request answered 504 and the app rendered nothing. Reloading does not fix
it. Restart with `npm run dev -- --force`. For screenshots meanwhile, `npm run build` + `vite preview` on another
port works (the saved logins are per origin — rewrite the origin in the storage state).

*Cost: a blank screenshot read as an app fault.*

### Dev "View as" a role shows every personal page empty, and Needs you never loads

27 Sep. Edward could not demo the site through a lead's eyes. Two causes, both invisible on screen: the role
preview changes only what the screens ALLOW — every request still runs as the Power Admin, so My Work and Needs
you show the admin's own (empty) work — and `preview-guard.ts` blocks every `rpc()` POST not on its short
read-only list, which includes `my_pending_approvals`. Use **View as a person** (ADR-0120); it passes RPCs
because the database runs the whole request read-only.

*Cost: a feature and an ADR before a C-level demo.*

### A pgTAP fixture made "after the cut-over" behaves as if made before it

27 Sep, pgTAP 190. `app_settings.task_list_gate_from` (and any `now()`-stamped setting) is written when the
migration RUNS — on `verify.sh`'s throwaway database that is seconds before the tests, so a campaign
"approved 2 hours ago" counts as older than the gate. Pin the setting inside the test (`update app_settings
… where key = …`) before building fixtures on either side of it.

*Cost: one failed full run.*

### A function reading `auth.users.raw_app_meta_data` works locally and fails in `verify.sh` / CI

27 Sep, ADR-0120. `scripts/db/local-stub.sql` builds a MINIMAL `auth.users` (id, email) for the throwaway
database; the Docker stack and production have Supabase's full table. plpgsql compiles lazily, so the
migration applied and only the test failed: `column "raw_app_meta_data" … does not exist`. The stub now has
`raw_app_meta_data` and `raw_user_meta_data`; any other `auth.users` column needs adding there too.

*Cost: one failed full run.*

### `supabase db push` printed none of the migration's `raise notice` lines

27 Sep, `20260927230000`. The data fix's `raise notice '… 5 re-opened task(s) put back'` never reached the
terminal, and Edward was told to expect it. Confirm a push's data fix with a read-only query instead —
`supabase db query --linked "select …"` works from here (as does `supabase migration list --linked`).

*Cost: a worried "I did not get the message", and a check on production.*

### One role lacks a permission every similar role has, and no migration ever removed it

27 Sep. The Account Director had no My Work on production. The role was made 5 Sep as a COPY of the
Account Manager's grants that day (`20260905190000`); the AM got `my_tasks:view` on 16 Sep with a backfill
limited to the AM (`20260916130000`). The local database, seeded later, copies the newer list, so local looks
right. Compare `role_grants` on PRODUCTION (`supabase db query --linked`) before reasoning from local.

*Cost: a role without its home page for eleven days.*

## A spec passes on a copy of an older commit and fails on the branch, the click landing on a dialog's grey backdrop

28 Sep, the regression check for `role-dashboards`. To compare against the code before the branch, a copy of
the older commit was checked out beside the repo with `node_modules` JUNCTIONED to the main checkout's, and the
full suite run on both. One spec (`deliverables-page.spec.ts:220`, Cancel in the Reinstate dialog) passed on the
copy and failed on the branch: `<div class="dialog-backdrop"> intercepts pointer events`. Nothing on the branch
touched dialogs. **Cause:** Vite serves files only from inside its root; the copy's `@fontsource-variable/inter`
resolved THROUGH the junction to the main checkout, outside the copy's root, and the log said *"The request id
… inter-latin-wght-normal.woff2 is outside of Vite serving allow list"*. The copy drew everything in the narrower
fallback font, so its three dialog buttons fitted and the old code "passed". With Inter loaded — the real app,
main included since `a3f34e4` — the buttons overflowed the 440px dialog (a real defect, I65.1, fixed).
**Rule:** a comparison run on a junctioned copy is not like-for-like; grep its Vite log for "outside of Vite
serving allow list" first, or compare `document.fonts` on both. The same applies to helper worktrees built with a
junction (see [A helper's worktree has none of the branch's recent work](#a-helpers-worktree-has-none-of-the-branchs-recent-work)).

*Cost: about forty-five minutes tracing a "regression" through the dialog code before measuring the fonts.*

## Browser specs fail on names after the demo scripts ran — "Dev Account Mgr 2" reads "Rasha El-Sayed"

28 Sep. `scripts/db/demo-dashboards.sql` and `demo-clients.sql` (the invented dashboard and client data, loaded
on top of the seed) RENAME the dev personas to realistic names and move campaigns about. Every browser spec
expects the bare seed — `PEOPLE.am2.name` is "Dev Account Mgr 2" — so a spec run after the demo scripts fails on
text that is right. **Rule:** run `e2e:local` only on `supabase db reset --local` (then restart
`functions serve`); reload the demo scripts AFTER the run, with `PGCLIENTENCODING=UTF8` set — from Git Bash on
Windows, `demo-clients.sql` otherwise stops on its Arabic: *"character with byte sequence 0x9d in encoding
WIN1252 has no equivalent in encoding UTF8"*.

*Cost: one false failure chased into the campaign page's account-manager line before the names gave it away.*

## A spec fails on some weekdays and passes on others, with nothing changed

28 Sep, two specs. `releaseSingleJob` dates a job with `dueInTwoWeeks()` — 14 days out, then on to the next
Sunday, so 14–20 days. `change-request.spec.ts` typed a NEW date of `day(20)`: on a Monday that IS the job's
date, Save sees no change, and the change-request dialog never opens. In `campaign-phases.spec.ts` a Week 1
ending `dayOut(14)` had its own planned delivery day land on the piece's `dayOut(10)` on some days, so moving
the piece into it moved no date and the "the date moves with the phase" line never showed. Both specs had been
failing for days, logged as "pre-existing". **Rule:** a date a spec types to CHANGE something must be outside
every range the fixture can produce (the change-request spec now uses 30/31 days out); when a spec fails with an
element simply missing after a Save, compare the typed date with the stored one before reading the product.

*Cost: two investigations, each first suspected as a product regression.*

## Typing a date by hand crashes the whole page — "Unexpected Application Error! Invalid time value"

29 Sep, production (I66.8). A user typed the Single job's due date instead of picking it and the page went white
with `RangeError: Invalid time value at Date.toISOString`. **Cause:** Chrome's year segment takes up to six digits,
and `20266-10-09` is a VALID HTML date string — `input.value` carries it — but not a valid ECMAScript one:
`Date.parse` is NaN, `toISOString` throws, `Intl…formatToParts` throws (a different stack frame). The day strip ran
that arithmetic on every keystroke's render, and the app has no error boundary, so one bad keystroke took the
page. String comparisons also lie (`"20266…" > "2026-…"`), so checks like `dueDay >= today` pass it. **Rule:** no
raw `<input type="date">` — use `components/DateField.tsx`, which passes on only `isRealDay` (`lib/time/real-day.ts`)
or `''`; anything that computes on a typed day guards with `isRealDay` first. To reproduce, set the value through
the native setter and dispatch `input` (Playwright's `fill` and keyboard typing do not produce a five-digit year).

*Cost: a production crash, and the same weakness in all 39 date boxes.*

## A browser test fails with "Couldn't load your permissions" right after you edited a file, and passes on the rerun

29 Sep (I66.7). L5 failed twice in a row for the admin only — the page stuck on `/` with the permissions error, no
failed request, no page error — and passed four times afterwards with the same code. **Cause (inferred):** the
Vite dev server was re-optimising after an edit to `src/app/permissions.tsx` (and a `git checkout` of it) while the
run started; the first page load of the run got the half-rebuilt module. **Rule:** after editing a file the dev
server serves, load one page by hand (or run a one-page probe) before a spec run, and rerun a failure once before
tracing it; if the code is the suspect, compare with the file restored, not with a stash that did not take.

*Cost: about fifteen minutes, including a stash that silently stashed nothing.*

## An escalation pgTAP file fails locally with counts in the dozens ("have: 65"), and passes in `verify.sh`

29 Sep (I66.4). `supabase test db` runs against the LOCAL database, which carries the demo scripts' invented tenant
(`d0000000…`) on top of the seed. `app.escalation_due()` and similar sweeps read every tenant, so suites 172 and
177 counted the demo tenant's rows ("have: 65, want: 0") — the test's own fixture was fine. **Rule:** judge
a pgTAP failure on a tenant-wide function with `bash scripts/db/verify.sh` (a throwaway database, as CI), not on
the local stack; see [Browser specs fail on names after the demo scripts ran](#browser-specs-fail-on-names-after-the-demo-scripts-ran--dev-account-mgr-2-reads-rania-el-masri).

*Cost: a few minutes reading escalation code that was not touched.*

## `supabase db query --linked` answers 400 "Too small: expected string to have >=1 characters"

29 Sep. A multi-line SQL passed as the ARGUMENT from Git Bash reached the Management API empty — the query string
was lost on the way, and the error names the API's validation, not the shell. **Rule:** write the SQL to a file in
the scratchpad and run `supabase db query --linked -f <file> --output-format json`; the rows come back under `rows`,
wrapped in an "untrusted data" warning to strip before `JSON.parse`. Reading production this way is read-only by
habit, not by the tool — never put a write in the file.

*Cost: a few minutes, and a first read of production that returned nothing.*

## The page crashes with "ReferenceError: X is not defined" while `tsc -b` is clean

30 Sep (I67.8, I69.2), twice. The Schedule died with "ProgressLines is not defined" and the client editor with "Button is not
defined" — the import was in the file, the export existed, the typecheck and the unit tests passed. **Cause:** the component was
used in one edit and imported in a SECOND edit a moment later; the Vite dev server on this machine picked up the first write and
missed the second, and kept serving the module without the import (the stack trace's `?t=` timestamp stays old). **Rule:** a
runtime "not defined" for a name the file clearly imports is a stale module — `touch` the file (and its importer) and reload
before tracing anything. Better: add the import in the same edit as the first use.

*Cost: about ten minutes the first time, and a browser test that failed on it the second.*

## Dozens of files show as modified in `git status`, and `git diff` on each is empty

30 Sep (I67.4). A `sed -i` over `src/features/campaigns/components/*.tsx` to repoint one import touched 60+ files that did not
contain it: `sed -i` (and `perl -pi`) in Git Bash rewrites every file it opens with LF endings, and this working tree is CRLF
(`core.autocrlf=true` normalises on commit, so the diff is empty while the stat changes). `git update-index --refresh` does not
clear it. **Rule:** never run `sed -i` / `perl -pi` over this tree — use the Edit tool, or a script that keeps CRLF
endings (see the Python trap above). To repair: convert the LF-only files back to CRLF, then `git update-index --refresh`.

*Cost: fifteen minutes, and a moment's fear that 60 files had been changed.*

## Every signed-in test user gets "Couldn't load your permissions" after a database reset, on every rerun

30 Sep. After a helper ran `supabase db reset --local` for a walk, every page opened with a saved session (`e2e/.auth/*.json`)
showed "Couldn't load your permissions" — the sessions belonged to the users of the database before the reset. Unlike the
29 Sep trap above, a rerun does not clear it. **Rule:** after any local reset, re-create the sessions before a spec or a
screenshot: `npx playwright test -c playwright.local.config.ts --project=setup`. Related: the reset also drops the jobs and
campaigns the walks created, and the demo script's bookings (`scripts/db/demo-dashboards.sql`) carry no `deliverable_id`, so
their Schedule chips read as ad-hoc and show no project — the real writer (`subtask-schedule`) sets it.

*Cost: three failed screenshot runs before the sessions were suspected.*

## A lead booking a new task for someone in another department is refused as a team lead

1 Oct (I71.4). On the Schedule, a Department Lead booking a NEW task for a person in another department got "This resource is
outside your write scope. As a team lead you can only book resources in your own team" (`schedule.outOfScope`) — though ADR-0098
lets a lead schedule anyone, and picking an EXISTING task for the same person worked. **Cause:** two reaches, not one. Scheduling
reach (`resource_in_scheduling_scope`, ADR-0098) is every calendar for a lead; WRITE reach (`in_write_scope`) is still their own
department. `BookingDialog` created the new task unassigned on the ASSIGNEE's department before assigning it, and
`sub_tasks_manage_insert` refused that half-made row with a bare RLS error — which `namedRefusal` / `refusalSentence` cannot word,
so the dialog fell back to a sentence written before ADR-0098. **Rule:** a row written on someone else's placement before the
assignment moves it must be placed where the CALLER writes (the dialog now asks `inWriteReach`; `update_task_assignment` restamps
it, ADR-0060 d.9). A refusal shown as `schedule.outOfScope` is a bare 42501 — find the statement before believing the words.
Related: "A null argument to `in_write_scope`…" above — what the writer puts in the row is the argument.

*Cost: logged first as a wording issue by a test-writing helper; a separate trace (85 of 85 pieces refused locally) found the cause.*

## A new permission fails on permission_catalog_action_check, or its test grant on granted_by

1 Oct (I71.6). Two refusals adding `dev_view:view`, each a full `verify.sh` run. **(1)** `permission_catalog.action` is checked
against eight words — view, create, update, delete, approve, export, manage, moderate (`20260802100000`). A natural verb such as
`use` fails the whole migration; name the RESOURCE for the thing and pick one of the eight. **(2)** In pgTAP, a `user_grants`
insert fails "null value in column granted_by" even when the test supplies it: `tg_stamp_granted_by` overwrites it with
`auth.uid()`. Set an admin's claims first (as test 038 does).

*Cost: two database runs, about ten minutes.*

## Every Library upload fails locally — "It did not upload. Try again." — and asset-url answers storage_unconfigured

1 Oct (I72). Every file in the upload box turned red; calling `asset-url` directly as a user answered
`503 storage_unconfigured`. **The local Edge Functions have no Backblaze keys at all** —
`supabase/functions/.env` holds OpenAI, email and the cron secret only — so locally nothing has ever
uploaded, downloaded, previewed or copied a Library file. `MAP.md` said "B2 is the REAL bucket" locally;
that was the design (ADR-0081 d.4), not the machine. **Do not stage asset rows through the service
role** to get past it: the house pattern is to stand in for `asset-url` and the bucket in the browser
(`page.route`), keyed `<tenant>/<client>/<folder>/…` exactly as the real function keys it — a made-up
key is refused by `library_add_version` and by the tenant-key trigger (`20261002130000`). See
`mockBucket` / `standInForTheBucket` in `e2e/local/coverage/library.spec.ts` and the Library walk. Real
B2 behaviour (multipart, the `ETag` CORS rule) is still unverified until Edward adds the keys locally.

*Cost: one walk run blamed on the new uploader, an hour on staged rows before the stand-in was found
in `people-chat-library-bookings`.*

## `supabase db push` stops with "deadlock detected (40P01)" on a migration that ran clean everywhere else

2 Oct, production, `20261002100000` (the Library): "Process … waits for AccessExclusiveLock … blocked by
process …" at `drop trigger … on deliverables`. A migration that drops or creates triggers on several
busy tables (deliverables, assets, campaigns) takes exclusive locks one table at a time, and live
traffic holding a share lock on the next table can close the circle. **It is a timing collision, not a
fault:** every migration here is wrapped in `begin; … commit;`, so the whole file rolled back
(`supabase migration list --linked` showed it absent) and the same push, re-run, went through. Check
the list, then re-run; only if it collides twice take the locks up front in one `lock table …` with a
`lock_timeout`.

*Cost: one failed push, ten minutes; none of the migration was applied.*

## A walk hangs for the whole test timeout on one click, then "worker process exited unexpectedly (code=143)"

1 Oct (I72). A walk's optional close — `await page.getByTestId('x').click().catch(() => {})` — never
returned when the element was absent: `playwright.local.config.ts` sets no `actionTimeout`, so a click
waits for the TEST timeout, and the walk's was ten minutes. The `.catch` hides nothing because nothing
throws. Give every optional action its own `{ timeout: 3000 }`, or `test.use({ actionTimeout: 15_000 })`
in a walk. A success `NoticeDialog` left open does the same to the NEXT click (its backdrop takes the
pointer) — close it by `${testId}-close`.

*Cost: three ten-minute runs before the hang was read from the trace.*

## "The AI stopped proposing" — and the function's logs and the OpenAI dashboard show no calls today

2 Oct (I73.3). Edward: neither the single job nor the campaign brief proposes deliverables "since the UI
changes". The function was healthy (key, credit, anon key all fine; the campaign wizard proposed on the
local stack). The real answer was in the DATA: production had started **no campaign since 26 Sep** —
six single jobs instead — so `generate-deliverables` was never asked; and the single job had **never
called it at all** (only the campaign wizard does, on reaching The work). Before tracing a model call,
count who reached the screen that makes it: read-only `supabase db query --linked` over `campaigns` by
`kind` and `created_at`, and `grep` for the hook's callers. Since ADR-0138 the call lives in
`src/lib/brief/generate-deliverables.ts` and both flows use it.

*Cost: half an hour on keys, logs and the local probe before counting the campaigns.*

## A person picker offers the wrong kind of people (team leads in the account manager box)

2 Oct (I73.4). The campaign wizard's account manager box showed department and team leads. There are
several "people" lists and they look alike: `useDeliverableOwnerCandidates` (leads — and, on some
tenants, account managers too, so the box LOOKED half right) versus `useAccountManagers` (holders of
`account_manager:manage`, through `users_holding_permission`). The 23 Sep wizard rework wired the box to
the owner list. When a picker is wrong, find which hook feeds it before reading permissions. **The
browser test must name who must NOT appear from the database** (active `department_lead` / `team_lead`
rows): a fixture persona can be inactive locally, and the first version of the spec passed against the
broken code.

*Cost: one spec that could not fail, caught only by running it against the old line.*

## The Figma desktop tool keeps returning the same section, whatever Edward selects or deselects

3 Oct (I74 mapping). `mcp__figma__get_metadata` / `get_screenshot` with no `nodeId` read "the current selection",
and the desktop server kept answering with section L (`1830:934`) after Edward had deselected it, selected the page,
and asked twice whether I was reading a stale cache. A reconnect (`/mcp`) did not change it. What worked: call
`get_metadata` with `nodeId: "0:0"` — the whole document (~7 MB, saved to `tool-results/`) — and pull every
`<canvas>` and `<section>` id out of it with a script; then read each section by its id. Always pass an explicit
`nodeId`; the frame ids for L and N are in `docs/TASKS.md` I74 and the 3 Oct review walk.

*Cost: five round trips with Edward, who rightly read it as the tool being broken.*

## A SQL script's first result never shows in the Supabase SQL editor — only the last query's table appears

4 Oct (production clean-up). A read-only script held two queries — the exact list, then a "near names" list. The
editor shows only the LAST statement's result, so Edward saw the near-names list (three approved "Harmony …" jobs that
must stay) and reasonably read it as "the delete will take these". A script handed to Edward for the SQL editor holds
ONE result-producing query; a second check goes in its own file (`01b_…`). A multi-statement delete script ends with
its check query for the same reason — that is the result he sees.

*Cost: an alarmed message about deleting live work, and a re-issue of the script.*

## Deleting a project fails with chk_brief_receipt_confirmed_is_complete on campaign_brief_receipts

4 Oct (production clean-up). Deleting a project's Library files set `campaign_brief_receipts.asset_id` to null (the
FK is `on delete set null`); `tg_brief_receipt_stamp` then treats the receipt as changed and re-stamps
`confirmed_by` from `auth.uid()` — null in the SQL editor — and the check refuses a confirmed receipt with nobody
behind it. The local dry run passed because no local brief had a confirmed receipt with a proof file. Delete a
project's `campaign_brief_receipts` (and `scope_acknowledgements`) BEFORE its assets — `Claude outputs/2026-10-04-cleanup/03_delete_projects.sql`.
A clean-up dry run must stage the production shapes it will meet (here: a CONFIRMED receipt pointing at a file,
written as a signed-in person) or it proves nothing. Run such scripts as `postgres`, without RLS: the Library's
folder guard lets standard folders go only in a system context.

*Cost: one failed production run (rolled back whole — nothing lost) and a second round of scripts.*
