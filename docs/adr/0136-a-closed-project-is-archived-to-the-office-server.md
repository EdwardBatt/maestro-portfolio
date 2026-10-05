# ADR-0136: A closed project's working files go to the office server 90 days after it closes

- **Status:** accepted (Edward, 1 Oct) — records Edward's answers of 1 Oct
- **Date:** 2026-10-01
- **Open Decision:** advances OD 30 (archive residency), as ADR-0023 d.5 did
- **Amends:** ADR-0023 d.4 (the 60-day clock on superseded review rounds is **retired**) and d.5 (the local target is
  reached by Maestro sending to it); ADR-0022 d.3 (the "Iraq local archive, later" is this)
- **Task(s):** I72

## Context

Edward, 1 Oct: *"We need to include an automatic archive option to the company's local backup server after a predefined
period… I have access to the local server. But have not determined structure. The archive timer should start from when
a project is closed."*

What exists: `archive-sweep` (ADR-0023) moves **internal review rounds** to a cloud archive bucket 60 days after they
are replaced; a `local` target is reported skipped, never moved. Whether its cron runs on production is a deploy-time
choice not visible from the repository (`docs/RUNBOOK.md`). A campaign or job is closed by `close_out_campaign`
(`closed_at`) and reopened by `reopen_campaign` (ADR-0091).

Edward's answers, one at a time:

| Question | Chosen | Rejected |
|---|---|---|
| The online copy after archiving | **C**: only the final files stay online | A, all removed; B, all kept |
| What stays online | **B**: Final assets, References, and each piece's version in use | A, without References |
| How long after closing | **B**: 90 days, a Power Admin setting | 30; 180 |
| Getting an archived file back | **A**: a "Bring back" button | B, by hand through a Power Admin |
| Who may bring back | **B**: anyone who may change that client's files (ADR-0134 d.2) — *"usually… the account manager when they set up the campaign"* | A, everyone |
| How long a brought-back file stays online | **A**: 30 days, then office-only again | B, for good |
| Reopening an archived campaign | **A**: nothing automatic; Bring back what is needed | B, everything back |
| The two clocks | **A**: only the new one; the 60-day rule is retired | B, both |
| How Maestro reaches the server | **B**: Maestro sends to the office server | A, the office server collects |

Edward also noted: *"the office uses a service with login… I cannot remember the name"* — the server's software and its
sign-in are not yet known.

## Decision

1. **One clock.** A project (campaign or single job) is archived **90 days after it is closed** — `closed_at` + the
   tenant's `archive_after_days` (default 90, a Power Admin setting). Reopening stops the clock; the next close starts
   it again. **ADR-0023 d.4's 60-day clock on replaced review rounds is retired**: nothing in a live project is archived.
2. **What goes to the office server:** working files, source files, every version except the one in use, and every
   review round. **What stays online as well:** Final assets, References, and each piece's version in use. Everything
   is copied to the office server; only the first group is removed online.
3. **Nothing online is removed until the office server confirms the copy** — size and checksum read back. A failed or
   unconfirmed transfer leaves the online copy and retries on the next run.
4. **An archived file stays listed** where it was, marked *Archived*, with its history. Its menu offers **Bring back**,
   to anyone who may change that client's files. Bring back copies it online again and tells the person when it is
   ready; it returns to office-only **30 days** later. A file copied from it into a new project (ADR-0134 d.10) belongs
   to that project and follows its clock.
5. **Reopening an archived campaign brings nothing back by itself.**
6. **Maestro sends to the office server.** The transfer runs from a scheduled, privileged job (the `archive-sweep`
   pattern: cron secret, service role, no user session) to the office server's address, **encrypted in transit, signed
   in with a credential held only as a Supabase secret, and accepted by the server from Maestro alone**. Nothing in the
   browser ever reaches the office server.
7. **The office side is not built here.** The server's software, its sign-in and its folder structure are Edward's to
   determine (the login service he could not name). Until its address and credential exist, archiving is **switched
   off** and nothing online is removed; every other part of this decision is built and waiting.

## Consequences

**Easier:** online storage holds what people use; years of layered files live on the company's own server; a retrieval
is one button and is recorded.

**Harder / new:**
- **Security:** the office server must be reachable from the internet. That is a door into the office network, opened
  on Edward's choice over the server collecting (rejected A, which needed no door). It must be locked down on the office
  side — encrypted, Maestro's credential only, ideally limited to the archive share — and that work sits with whoever
  runs the server.
- The transfer and Bring back depend on the office line; a power cut delays archiving and retrievals, never loses files
  (d.3).
- The transport depends on the unnamed service: S3-compatible, WebDAV and SFTP each need a different client in the job.
  Chosen when the service is known; d.6's rules hold for any of them.

**Locked in:** one clock from closing; final files stay online; nothing online is removed before the office copy is
confirmed; retrieval is per file; Maestro is the sender.
