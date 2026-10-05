# ADR-0093 — A date after go-live warns and is recorded; nowhere is it refused

**Status:** accepted (Edward, 14 Sep 2026)
**Amends:** ADR-0075 d.9 (the one refusal), ADR-0088 d.7 and d.7a (the go-live ceiling on an
extension request and on the promised date)
**Tracker:** I48.24, I48.25

## Context

ADR-0075 d.9 set the philosophy for due dates — *"the system is non-blocking … warn, allow to
proceed after warning, and record the override"* — and carved out one exception: a date **after**
the campaign's go-live *"is not a tight deadline but a typing mistake"* and is refused. ADR-0088
carried the same ceiling into the extension request (d.7) and the promised-date change (d.7a), and
three database functions enforced it.

The automated retest of 14 Sep (K6b) found the first of them refusing the **go-live day itself**:
`deliverable_due_at_change` compared 18:00 Iraq on the chosen day with `go_live_at` as a moment —
the wizard stores go-live at midnight UTC, 03:00 Iraq — so the dialog said *"Impossible as planned…
if you proceed, the override is recorded"* and the database answered *"that date is after the
campaign goes live"*. Two parts of the product disagreed in front of the person.

Two fixes were possible: make the database compare days, as the screen does, or drop the refusal.
Edward, 14 Sep:

> *"The message should advise the user that the proposed new date exceeds the scheduled go-live
> date, and that they should seek the approval of the client. Show the warning and allow the users
> to proceed and ensuring the action is recorded in the audit logs."*

Asked whether that holds at all three doors — the promised-date dialog, the campaign wizard, the
extension request — *yes to all three.* And on extensions: *"Requests to change task deadlines are
subject to AM approval … the AM can refuse."*

## Decision

1. **A date after go-live is a warning, not a refusal, at every door.** The wizard's due dates,
   the promised-date dialog and the extension request all say the same thing in their own words:
   the date is after the campaign goes live; the client's agreement is needed; proceeding is
   recorded. None of them disables the next step.

2. **The record says what the person was shown.** `record_due_date_override` accepts a third
   severity, `after_go_live`, alongside `tight` and `impossible`. The override row
   (`sla_events.due_date_override`) carries it, so a pattern of dates accepted past go-live is as
   visible as a pattern of impossible ones (ADR-0075 d.9's point).

3. **The evidence rule is unchanged.** The promised-date change still needs the client's agreement
   filed in the campaign's References (ADR-0088 d.7a). A date after go-live is exactly the case that
   rule was written for.

4. **An extension past go-live is asked for like any other, and the account manager decides.**
   The screen says the account manager will need the client's agreement before approving it; the
   approver sees the same arithmetic and refuses or approves (ADR-0088 d.4). Nothing is decided by
   a wall.

5. **Past the deliverable's own due date, the arithmetic says "past", not "minus".** (I48.25.)
   *"Leaves -27 working days"* becomes *"This is 27 working days past the deliverable's own due
   date — the account manager will need to approve it, and may need the client's agreement."*

6. **The three functions are re-emitted whole** (`sub_task_extension_request`,
   `deliverable_due_at_change`, `write_campaign_content`), each with only the refusal removed;
   `record_due_date_override` gains the severity. pgTAP 101 and 112 assert the new behaviour.

## Consequences

**Easier.** One rule everywhere: the system warns, the person decides, the record shows it. The
disagreement between screen and database cannot recur, because neither refuses.

**Harder.** A date past go-live can now be committed by mistake, and the only guard is the
warning and the override row. That is the trade ADR-0075 d.9 already made for every other date,
and the audit is what makes it honest: the override names the actor, the severity and the day.

**Not decided here.** Whether a deliverable due after go-live should change the campaign's own
go-live, or flag the campaign on the list. Whether the approver's decision line should require a
note when approving past go-live.

## Addendum — 20 Sep, a deliverable is never created without a due date

**Edward, 20 Sep: *"we should not allow a deliverable (and associated tasks) be entered without a
due date"*; *"Due Date is mandatory."*** Today the wizard's rows, `add_campaign_deliverable`
(`p_due_at default null`) and the single-job flow all accept none, and a task under a dateless
deliverable has nothing to be measured against (ADR-0075 d.4).

**d.7 — Every door that creates a deliverable requires its due date.** The wizard refuses *Next* on
a row without one (the field is marked required, the refusal names the row); `add_campaign_deliverable`
and the single-job release refuse without `p_due_at`, in words; a trigger guard refuses a direct
insert of a campaign deliverable with `due_at is null` (ADR-0037 — the RPC and the PATCH are governed
alike). An ad-hoc deliverable made by the schedule (ADR-0035) takes its task's day and so always has
one. The warning rule (d.1) is unchanged: a date past go-live, or past its phase's end (ADR-0096
d.7), warns and records — it is never refused; only its absence is.

**d.8 — Existing rows without a date are left as they are and shown.** No backfill and no `not null`
constraint — production carries dateless deliverables and a constraint would refuse the migration
or invent a date. The campaign page and the Deliverables page mark such a row *"no due date — set
one"* beside the *Change promise* door, and a task under it shows the same words where its
deadline would be. Tracked as `I53.6`.

