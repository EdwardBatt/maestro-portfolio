# ADR-0092 — Work in progress is shown, and failures are reportable

**Status:** accepted (Edward, 13 Sep 2026)
**Tracker:** I48

## Context

Today an action that takes time (a submit, a save, an upload, a brief ingestion) shows only a
spinner *inside the button it was pressed from* (`BusyButton`). For a quick save that is fine; for
anything that spans several requests or calls a model it leaves the user unsure whether the app is
working or stuck, and nothing tells them what is happening. When something fails, the message is
often generic — "Something went wrong", "Save failed. Please try again." — which tells the user
neither what broke nor what to do, and there is no way for them to get the failure to someone who
can act on it.

Edward, testing 13 Sep: a processing action *"must display a spinner modal … please wait while …
followed by a success or error message. The error messages must not be generic but plainly worded …
I would also appreciate adding a button to error messages so users can submit emails to the
power-admin which include the error message."*

There is already a reusable `Modal` (backdrop/Esc dismiss, focus trap) and a `BusyDialog`
("please wait", blocking, no dismiss) in `src/components/Notice.tsx`, but only four recent surfaces
use the Modal and most dialogs hand-roll their own backdrop (see the modal audit, 13 Sep).

## Decision

- **d.1 — a waiting action shows a blocking "please wait" modal with a specific message.** Any
  action that submits, saves, uploads, ingests or otherwise makes the user wait on a result shows a
  modal worded for what it is doing ("Saving the brief…", "Reading the document…", "Releasing the
  job…"), for the duration. The button spinner stays only for an inline save the user watches
  complete in place; the blocking modal is for everything that spans requests or leaves the surface
  in a state nobody should act on. This is the existing `BusyDialog`, given a message and used
  consistently.
- **d.2 — success and failure are both said, plainly.** The action resolves to a short success
  confirmation or an error. Error copy states what happened and what to do next, in the user's
  words, never "Something went wrong" on its own (AGENTS.md's error-copy rule, now enforced on the
  surfaces this touches).
- **d.3 — every error dialog can report itself to the administrator.** The standard error dialog
  carries a "Report to your administrator" button that sends the failure — the message, any error
  code, what the user was doing, and who/when — by email to the tenant's Power Admin(s) at their
  recorded address, **server-side via Resend** (Edward, 13 Sep), reusing the notify-email path. A
  new Edge Function `report-error` looks up the tenant's `admin.*`-holding users' emails and sends;
  `EMAIL_ALLOWLIST` fences it locally exactly as the other mail does. The user gets a "sent"
  acknowledgement; if the report itself cannot send, the dialog says so and still shows the original
  error.
- **d.4 — one dialog chrome.** The reusable `Modal` is the single backdrop/Esc/focus implementation;
  dialogs migrate onto it rather than each carrying its own `dialog-backdrop`. The booking dialogs
  (`BookingDialog`, `EditBookingDialog`, `AssignmentRequestDialog`) move first (they were the report
  that surfaced this); the remaining ~14 are a consistency pass tracked under I48, not a blocker.

## Consequences

Shared building blocks: a `ProcessingDialog` (message-carrying `BusyDialog`) and a `ResultDialog` /
extended `NoticeDialog` with the report action, plus the `report-error` Edge Function (Deno, Zod at
the boundary, the error envelope, no grant-table read — ADR-0037). The pattern is applied first to
the flows under test (intake single-job, the wizard, uploads), then rolled outward. The email
carries only the error text and context the user already saw — no secrets, no stack beyond the
message — and goes to the tenant's own admins, so it respects tenant isolation.

## Not decided here

Whether failures are also logged server-side for the admin to see without an email (a later
observability question). Rate-limiting repeated reports of the same error. Migrating every one of
the ~14 remaining hand-rolled dialogs — scheduled under I48, done as capacity allows, not gating the
testing pass.

## Addendum — 13 Sep, optional is not silent

Edward, testing: *"I do not want code that softly fails in production."* The brief-receipt screenshot
filing was **silent** on failure — `recordReceipt` saved the receipt with a null `assetId` and told
the user nothing (only a console warning), a soft-fail inherited from "evidence is optional"
(ADR-0085/0066).

**Decided (d.5):** evidence stays OPTIONAL — a job is not blocked by a filing failure, and the
arrival/clock still save — **but a filing failure is SURFACED, never swallowed.** When a provided
screenshot fails to file, `recordReceipt` now shows the plain, reportable error
`campaigns.receipt.fileFailed` ("The request was saved, but the screenshot could not be filed … add
it again to retry, or report this"). No silent soft-fail ships. This removes a silent path rather
than adding one; "optional" means the step may be skipped, not that its failure is hidden. The local
`asset-url` 503 (Backblaze `B2_*` unset in dev) is what exposed it; in production B2 is configured.
