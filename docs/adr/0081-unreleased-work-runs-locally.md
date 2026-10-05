# ADR-0081: Unreleased work runs locally, and a shared environment is bought only when there is something to show

- **Status:** accepted
- **Date:** 2026-09-10
- **Open Decision:** none — raised by Edward, 10 Sep, ahead of the intake redesign
- **Task(s):** I43 (the environment), L5.1 (the e2e smoke has never had a safe target)

## Context

**Every change to this system so far has gone straight to production, and that has been correct.**
Each was small, corrective, and verified before it landed: `scripts/db/verify.sh` runs every migration
and all 97 pgTAP suites against a throwaway Postgres, CI runs it on every push and pull request, and
Edward applies the migration by hand afterwards. Nothing about that has failed.

**What is coming is a different shape of change.** Edward, 10 Sep: a global new-request action, one
intake that becomes either a campaign or a single job, promotion between the two, duplicate detection,
and a design pass over the look and feel — *"the task above is only a part of the changes required"*.
This alters how **all** work enters the system. Exercising it does not mean reading a screen; it means
creating campaigns, assigning them, uploading briefs and watching notifications arrive. On the
production database that is indistinguishable from real work, and the pilot is live: real users, real
clients, 131 ad-hoc deliverables, work in flight this week.

**The gap is narrower than "we have no test environment", and naming it precisely is what decides the
answer.** `verify.sh` already isolates **schema** completely, and it is good — it caught a
cross-tenant hole before it shipped (`077` test 20) and a re-entrancy bug in ADR-0080's trigger. What
it does not cover is anything that is not SQL: Auth, Storage, the sixteen Edge Functions, and the act
of using the product. There is no environment in which a person can *drive* this change.

**The first draft of this ADR reached for a Supabase preview branch, and Edward asked the right
question: "is there an alternative — local docker for example?"** There is, it is better for this
job, and it is free. The draft is recorded as rejected below rather than quietly replaced.

**What actually makes an environment dangerous is its credentials, not its database.** The Edge
Functions read **fourteen** environment variables, and the ones that matter point outside Supabase:

| | Reaches | Consequence of getting it wrong |
|---|---|---|
| `RESEND_API_KEY`, `NOTIFY_EMAIL_FROM` | real inboxes | a test campaign emails a real client; cannot be recalled |
| `B2_KEY_ID`, `B2_APP_KEY`, `B2_BUCKET`, `B2_ARCHIVE_BUCKET` | the live file store | test uploads land in the production bucket, which already holds 16 orphans nobody can attribute (Edward declined to clear them, 8 Sep) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | a billed account | every brief ingested is charged |
| `CRON_SECRET`, `SITE_URL`, `APP_BASE_URL` | schedulers and links | invite and password emails point at the wrong build |

**This is the whole argument for local, and it is not that the keys are all removed — d.3 to d.5
keep three of the four.** It is that a local stack starts with **nothing**, so each key is present
only because somebody put it there, on purpose, having answered what it reaches. A hosted preview
branch starts from the parent project: the same four are present by inheritance, having been decided
by nobody, and whether Supabase copies function secrets into a branch would have to be verified
before any of it could be trusted. Isolation that *looks* complete and is not is worse than none.

**And the local stack is already configured.** `supabase/config.toml` has never been trimmed: API on
54321, Postgres 17 on 54322, Studio on 54323, storage enabled, and **Inbucket on 54324** — a local
mail catcher. That last one matters more than it looks. ADR-0012 made sign-in an OTP **code** flow
because corporate link scanners consume magic links, so invite and recovery are things you have to
receive an email to drive at all. Locally they land in a catcher and can be driven end to end; on a
hosted branch they need real email, which is the one thing that must not be switched on.

**The README says "remote-only — no local Supabase, no Docker", and nothing records why.** There is no
ADR, no note in `AGENTS.md`, nothing in `docs/memory/`. *Reason unknown — inferred from the README:* a
simplicity choice made when the database work was schema-first and reading the hosted project was
enough. `verify.sh` already draws the distinction in its own header — *"that rules out a local
Supabase, not a disposable Postgres"* — so the convention has always been about convenience rather
than principle. It is reversed here, for this purpose, and the README is corrected in the same change.

**Two things remain true whichever environment is chosen.**

*A fresh environment starts empty.* `[db.seed]` points at `./seed.sql`, and that file **does not
exist**. Duplicate detection cannot be exercised against an empty database, and neither can anything
else worth driving.

*Migration order is what `verify.sh` proves, and a long-lived branch puts it at risk.* Migrations are
timestamped filenames applied in that order. The pilot will keep needing fixes, so `main` will keep
gaining migrations dated **after** ones authored on the branch. Production applies what it receives
when it receives it; a fresh environment applies from empty in filename order. The two can hold
identical migrations and reach different schemas, and nothing would say so.

**What local CAN do, stated plainly because the first draft of this ADR did not.** It is the whole
product, working: the app in a browser, real Postgres with the real migrations, real Auth including
ADR-0012's OTP code flow, the Edge Functions, Studio, and Inbucket catching every mail. Any flow in
this system can be driven end to end by the person sitting at the machine.

**The one thing it cannot do is be opened by somebody else.** `localhost` exists on one computer, so
the team cannot review the redesign on their own screens, a pilot user cannot be shown a change
before it lands, and CI cannot point Playwright at it — `L5.1`'s e2e smoke still has no target that
is not production, and `e2e-smoke.yml` has carried *"Prefer a STAGING project over prod so the authed
test never touches live data"* in its header since August. Vite's `--host` reaches the office LAN and
covers "come and look at this" from another desk; it does not cover anybody remote, and it is not a
deployment.

## Decision

1. **Unreleased work runs against a LOCAL Supabase stack** (`supabase start`), and the README's
   remote-only line is corrected to say what it now means: remote-only for **reading and releasing**,
   local for **building anything that has to be driven**. `verify.sh` is unchanged and remains the
   arbiter of whether migrations compose.

2. **Local is chosen because it inherits nothing.** The credential table above is the decision: on a
   hosted branch each row is a thing to remember, and forgetting one is silent and outward-facing;
   locally each is absent until deliberately added, so the failure is a function that refuses. This
   is the same reasoning as deny-by-default RLS, applied to an environment.

3. **Email is LIVE locally, and every seeded account is a plus-address on one real mailbox.**
   Edward, 10 Sep: *"it is actually ok to leave email on as we can seed with my …+extension for
   different users, this would make testing more reliable."* Gmail delivers `maestro.dev+fadia@` to one
   inbox, so a seeded Team Member, Team Leader and Account Manager each have a working address that
   reaches nobody but Edward. This ADR's first draft switched email off; that was safe and it was
   worse, because the notification path is a third of what the new intake does and an unsent email
   proves nothing about copy, timing or who was told. Note the two halves behave differently and
   both are wanted: Supabase Auth's own mail — invites, OTP codes, recovery — goes to **Inbucket**
   regardless, so ADR-0012's code flow is drivable without leaving the machine, while `notify-email`
   goes out through **Resend** and actually arrives.

3a. **The safety of d.3 rests on d.6, so a fence turns that discipline into a refusal — BUILT.** A
   plus-addressed seed reaches one person; a real address in the local database reaches a client, and
   the only way one gets there is copying production data, which d.6 forbids as a habit rather than
   as a rule. `EMAIL_ALLOWLIST` is read by `notify-email` and **unset in production**, so it is inert
   there and cannot change what a released system does; set locally, a recipient matching no entry is
   refused before the send and the reason is logged rather than looking like a failure.
   `_shared/email-allowlist.ts` holds the predicate so it is unit-testable, and **its own tests
   refused the first implementation**: plain substring matching fails the one case the fence exists
   for, because `maestro.dev+fadia@example.test` does not contain `maestro.dev@example.test` — the tag sits
   between the local part and the `@`. It now compares plus-stripped addresses, accepts `@domain`
   entries for a catch-all, and **fails closed on a misconfigured list**: a value that is SET is
   somebody saying "fence this", and a typo leaving no usable entries must not read as "fence off".

4. **The real B2 buckets are used, and dev objects are self-identifying by construction.** Edward,
   10 Sep: *"we should use the buckets, but keep track of everything that needs to be deleted."*
   The key format settles how: `asset-url` writes
   `${tenant}/${client_id}/${folder_id}/${uuid}-${filename}` (`index.ts:109`), so **the tenant id is
   already the top-level prefix**. Seed with a tenant UUID production has never used and every dev
   object lands under one path that a single prefix delete removes — tracked by construction rather
   than by a list somebody maintains, which is the difference between this and the 16 orphans.
   **Collisions are impossible**: every key carries a fresh `crypto.randomUUID()`, so even a local
   row that reused a production tenant and folder id could not overwrite a production object. This
   ADR's first draft demanded a separate bucket and argued a prefix could not be untangled — that was
   wrong about this key format, and using the real buckets exercises the real path.

5. **OpenAI is set locally, deliberately.** Brief ingestion is most of what the new intake has to
   exercise and a stub would prove nothing about a real model's output. Edward, 10 Sep: *"the cost of
   the ingestion is negligible and thus far the $20 credit is still showing as unused, despite actual
   usage."* That is the answer, and it is also the reason `I34.5` — measure real cost, unticked since
   2 Sep — stays open rather than closing here: a credit reading as unused after real usage is not
   yet a measurement, and building on this branch produces one as a side effect.

6. **A committed `supabase/seed.sql`, deliberately synthetic**: one tenant, a handful of people across
   two departments, a few clients and campaigns with names that are obviously invented. **Not a copy
   of production** — that is real client work and real people's names, and residency is still
   unsettled (ADR-0044 d.6, reopened by ADR-0049 d.6). `supabase db reset` re-applies every migration
   and this seed in seconds, which is what makes iterating on schema shape cheap; it also becomes the
   fixture the e2e suite has never had.

7. **One long-lived integration branch, not a series of feature branches**, because the change is not
   shippable in pieces: a new front door that half exists is worse than the two doors there are now.
   **`main` merges INTO it at least weekly**, and every merge re-runs `verify.sh` — which is the
   entire discipline for d.8. A migration already applied to production is never edited.

8. **Migration order is re-proved on every merge from `main`.** `verify.sh` applies from empty in
   filename order, so it is the thing that catches a branch migration that no longer composes with
   what production has since received.

9. **A SHARED environment is deferred until there is something worth showing** — and it is named now
   so the decision is not made under pressure later. **Deferred on evidence, not optimism** (Edward,
   10 Sep): *"I can screen share and no one is genuinely assisting in testing in any case."* There is
   one developer and one tester and they are the same person, so the only thing a URL would buy today
   is remote review, which a call already covers. **The signal that d.9 is no longer deferrable is a
   second person testing** — not a date, and not the size of the change. It will be a **second Supabase project on the
   cheapest tier that works**, not per-hour preview branching: a separate project shares no
   credentials with production by construction, costs nothing per hour, and gives `L5.1` a permanent
   target rather than one that exists only while a branch is open. Preview branching is rejected for
   this project — it bills per branch-hour for ergonomics (a database per pull request) that a
   one-developer repo does not need, and it is the option whose isolation has to be verified rather
   than being true by construction.

10. **Merging to `main` does not release anything.** The intake redesign reaches users when Edward
    applies its migrations and deploys, exactly as today. This ADR changes where work is *made*, not
    who releases it.

## Consequences

**Easier.** There is somewhere to drive a change before real people meet it — which the pilot has
never had, and which every ADR since 0072 has quietly wanted: four of the faults Edward found on
6 Sep, and all three on 9 Sep, were found by using the live product because there was nowhere else to
use it. `supabase db reset` makes a schema change cost seconds instead of a push-and-inspect round
trip against a live database. The OTP sign-in flow becomes drivable. `seed.sql` gives every future
test a realistic fixture instead of `helpers/seed.sql`'s five people. And it costs nothing.

**Harder.** Docker Desktop has to be running, and this machine has a recorded history of CLI friction
— the README's own "hard-won" notes name VPN/proxy interference and a `db push` that reached for
Docker when the directory was not linked. Two databases to keep in step, and d.7's weekly merge is
real work that must be done rather than intended. A long-lived branch is the shape most likely to rot,
and this ADR chooses it knowingly because releasing a half-built front door is worse. **No link to
send**: local is complete for the person running it and invisible to everybody else, so for as long
as d.9 is deferred, remote review means a screen recording or a call — a real cost during a
design-led change, and the thing to watch for deciding d.9 is no longer deferrable.

**Worth knowing, not blocking:** `verify.sh` pins **postgres:16** while `config.toml` runs **17**.
The suite has been proving migrations on a major version neither local nor production uses. It has
never bitten, and it is not this ADR's job to fix — but the day it does, the symptom will be a suite
that passes and a deployment that does not.

**Locked in.** That an environment is defined by its credentials and not by its database — so adding
a fifteenth environment variable means asking what it reaches and what a local stack should do with
it, in the migration or the ADR that adds it. That production data is never copied sideways: fixtures
are made, not harvested. And that `verify.sh` remains the arbiter of whether migrations compose,
which is why it runs on every merge and not only before a release.

## Rejected

**A Supabase preview branch** (this ADR's own first draft). It bills per branch-hour for a
database-per-pull-request workflow a single-developer repo does not need; it starts from the parent
project, so every credential in the table above becomes a thing to remember rather than a thing that
is absent; and whether it inherits function secrets would have to be verified before any of it could
be trusted. It buys a URL, which is real — and d.9 buys the same URL for less, permanently, when it
is actually needed.

**A second Supabase project, now rather than later.** Correct eventually (d.9) and premature today:
there is nothing to show until the Figma flow is built, and a staging project that exists before it
has a purpose is one more thing to keep in step with production for no return.

**Doing nothing and working on production, carefully.** This is what has happened until now and it
has held only because every change was small. It is what this change cannot be: driving the new
intake means creating campaigns, assigning people and sending notifications, and there is no careful
way to do that in a system twenty-five people are using.
