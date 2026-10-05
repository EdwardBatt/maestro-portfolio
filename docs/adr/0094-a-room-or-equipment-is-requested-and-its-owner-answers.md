# ADR-0094: A free room or piece of equipment is booked by whoever needs it; a taken one is a request its owner answers

- **Status:** accepted (Edward, 16 Sep — "if written as per my answers, no pending decisions")
- **Date:** 2026-09-16
- **Open Decision:** none — Edward, 16 Sep, decided one point at a time while reviewing `I49.69`
- **Task(s):** I50 (new block); corrects the premise of `I49.69`
- **Depends on:** [ADR-0087](0087-booking-outside-your-reach-is-a-request-the-lead-answers.md)
  (a booking you cannot make yourself becomes a request — the same shape, for the resources that
  are not people), [ADR-0037](0037-one-authorization-primitive-one-call-path.md) (authority is
  decided in the database, once), [ADR-0035](0035-adhoc-reviewable-deliverables.md) (a booking of a
  *person* is always a task — untouched here), [ADR-0069](0069-a-task-states-what-it-is-waiting-for.md)
  (a task shows what it waits for). **Amends** [ADR-0042](0042-sub-task-resources.md) d.4 and d.6
  (the scheduler no longer books a task's required resources silently over a clash — see d.3).
  Relates to ADR-0070 d.6 (who is told about an approval) and ADR-0068 (ask first, and know what the
  answer costs).

## Context

Edward, 16 Sep: *"Booking a room, equipment etc. (not people) should be request → approve/deny →
book. This allows anyone to book as it is a request. The only issue is the need to identify the
resource owner."* Then, on seeing the cost of a three-day wait for an answer: *"if a resource is
free when the request is made, it should be autobooked, no approval required — the approval only
required for conflict management."* And on the two paths: *"we cannot have two conflicting paths
for the same functionality."*

### What a room or equipment booking is today

A resource is a person, a piece of equipment or a room (`resource_kind`). Booking a person is
assigning a task (ADR-0035, ADR-0060) and is not in this ADR. Booking equipment or a room happens
two ways, and they do not agree:

- **A plain reservation** from the `+` on a `/schedule` cell: a block of time, a note, no task
  (`BookingDialog.tsx:388`). Needs `bookings:create` **and** reach over the resource
  (`bookings_scheduler_insert`, `20260823110000`). A team member holds neither, so a designer
  cannot book the studio, cannot ask for it, and does not see the `+` (`I49.70`).
- **A task's required resources** (ADR-0042): the task lists the kit it needs, and `subtask-schedule`
  books each for the task's days when the task is scheduled — silently, and *over* a clash (d.6:
  "a clash raises; it does not block"). The booking is made under the scheduler's authority.

The dialog that edits or cancels either is the same one a task booking uses, through the branch
`I49.69` wrongly called dead (`EditBookingDialog.tsx:463`, `:616`).

### What already exists for "approval", and how much of it works

Three pieces were built in M4.2 and never joined up: a tick box **"Requires approval"** on
Admin → Resources (`resources.requires_approval`) that parks a booking as `tentative`
(`deriveInitialState`, `state-machine.ts:94`); `approve` / `reject` actions in `booking-transition`
for a `bookings:approve` holder; and **no screen that ever calls them.** A `tentative` reservation
sits until someone with the grant happens to open it — and while it sits, the grid and the clash
check count it, so an unanswered request blocked the room. In the local tenant, 0 of 7 resources
set the flag.

ADR-0087 rejected reusing this for people, for three reasons; the decisive one applies here too:
**the requester cannot write the row** without a definer bypass on `bookings` itself.

### The schedule is one list

`/schedule` lists every resource down the side; the *Kind* filter (people / equipment / room) exists
but defaults to everything. Edward, 16 Sep: *"it is not practical to show all resources and people
this way."* Rows that appear only when booked were considered and rejected — a free room is
exactly the one you want to look at.

### Options weighed

**A — open plain reservations to everyone and notify afterwards.** Rejected as first drafted (the
room is taken before anyone who minds it has seen the request) — and then **adopted for the
free-slot case only** (d.1), where there is nobody to mind: nothing is taken from anyone, and the
owner keeps the power to move or cancel it (d.9).

**B — reuse `requires_approval` + `tentative` + `bookings:approve` and build the missing screen.**
Rejected. The requester still cannot insert the row; "who answers" stays a permission, so the owner
question is not answered; and a `tentative` row holds the slot while it waits.

**C — every booking is a request an owner answers.** The first draft. Rejected by Edward on the
wait: an owner on leave is a studio nobody can use for three days, and the system has no reminder
machinery to chase them (`I41.10`). Kept for the one case where somebody *must* decide: the slot
is already taken.

**D — free means booked; taken means a request, and the requester chooses how.** Chosen. It is the
simplest: the common case needs nobody; the owner's job is conflicts only; and a task's required
kit goes through the same door instead of its own.

**E — a per-resource "self-service" tick** to gate chosen resources always. Declined (Edward:
option A of decision 7) — a fourth state to explain; reconsider only if the pilot shows a room
that must always be gated.

## Decision

The decisions are numbered as Edward answered them; each was put as options and answered singly.

1. **Anyone signed in to the tenant may book a free room or piece of equipment, at once, with no
   approval.** No booking grant is needed. The booking is `confirmed`, carries `requested_by`, and
   is written by a `security definer` RPC `book_resource` as if by the resource's owner — the
   caller never writes `bookings` directly. *Free* is decided at that moment by the resource's own
   capacity model: for `exclusive`, no confirmed booking overlaps; for `pooled`, fewer than
   `pool_size` do. A person is never booked this way; a person is assigned (ADR-0035, ADR-0087).
   Nothing about booking people changes.

2. **A taken slot becomes a request, and the requester chooses which kind.** The same form, told
   *"Studio A is booked Thu 9–12 by Sara (Kite Travel shoot)"* — or *"already requested by Ali"*
   when what is there is another pending request — offers exactly three ways forward, and no
   fourth:
   - **Choose another slot** — the form stays open on the free slots; picking one books it under d.1.
   - **Share the slot** — a request to the *holder* of the existing booking to use the resource
     together. Offered only on an `exclusive` resource (a pooled unit is not shared; it is
     another unit, or it is full).
   - **Urgent — escalate** — a request to the resource's *owner* that this need outranks the
     existing booking. The requester must type a reason.
   A request is a row in `resource_requests` (tenant, resource, requester, span, hours, note,
   kind `share` · `escalate`, reason, status `pending` · `approved` · `refused` · `withdrawn` ·
   `superseded`, decided by / at, decision reason). **It holds nothing:** the clash check, the
   capacity maths and the exclusion constraint do not see it. It is *shown* on the Rooms &
   equipment view (d.8) as a chip that is visibly not a booking — *requested* — so the owner sees
   demand and the next requester sees they are not first.

3. **A task's required resources go through the same door.** *Amends ADR-0042 d.4 and d.6.* When
   a task is scheduled, its person is booked as today; each room or piece of kit on its resource
   list is booked under d.1 if free, and if taken, the scheduler is given d.2's three choices for
   that line before the schedule is saved. **The task goes ahead regardless** (Edward, decision
   2a, option A; ADR-0069): each resource line on the task shows *booked · requested · denied*,
   and the person's chip on the People view carries a pill with the same state, so anyone reading
   the schedule can open the Rooms & equipment view for the detail. A denied line tells the
   scheduler, who moves the day or drops the line; nothing holds the assignee.

4. **Every non-human resource has an owner, and there is always somebody to answer.** A new
   nullable column `resources.owner_id → user_profiles`, set in Admin → Resources where the
   "Requires approval" tick box is today (d.10). An escalation goes to the owner; a share goes to
   the holder of the booking being shared, and the owner is told. If a resource has no owner, an
   escalation goes to the `bookings:approve` holders whose reach covers the resource (ADR-0087
   d.6's rule); if there are none, to the tenant-wide `bookings:approve` holders (Traffic Manager,
   Power Admin). **A request is never refused for want of an answerer.** The chain is one function,
   `resource_request_approvers(p_request)`, and the notified set equals the deciding set (the
   anti-drift assertion ADR-0087's test `090` carries).

5. **What the answerer may do.**
   - **A share** (the holder answers): **Accept** — both bookings stand, each marked `shared`;
     or **Deny** with a reason.
   - **An escalation** (the owner answers): **Approve and bump** — the existing booking is
     cancelled, its holder told who bumped them and why, and the requester's booking is written
     under d.1's RPC; the owner confirms first (*"This cancels Sara's booking (Kite Travel shoot).
     She will be told. Continue?"*, ADR-0068) and the bump is audited. Or **Move** — the owner
     changes the request's day or hours to a free slot and approves it in one action; the
     requester is told the new time. Or **Deny** with a reason.
   - **Approval IS the booking, made by the answerer.** `decide_resource_request` checks the
     caller is the right answerer for that request kind, re-runs the free test at that moment,
     and writes or does not. If the slot has changed under it (a third booking), the answer is
     *Move* or *Deny* — never a refusal with no way forward.

6. **A denial always carries a reason** (Edward, decision 5, option B). The requester is told the
   reason and, because d.2 gave them three ways forward, they know which one applies next. Nothing
   was booked, so nothing is undone.

7. **A request nobody answers passes itself on; a request that becomes moot closes itself.**
   - Unanswered by the end of the working day *before* the slot (the resource's office calendar,
     ADR-0079), a request moves to the next rung of d.4's chain, flagged *unanswered by owner*;
     the requester sees *"waiting — passed to Production lead"*. Built on the chain, not on
     reminders — there are none (`I41.10`). A daily sweep, the way `expire_holds` already runs.
   - The requester may **withdraw** while it is pending.
   - A resource that is retired (`is_active = false`) auto-denies its pending requests with the
     reason *resource retired*. Approving one request over another for the same span marks the
     loser `superseded` with the reason, requester told.

8. **The schedule gets two tabs: People (default) and Rooms & equipment.** Same grid, split by
   `resource_kind`; the *Kind* filter becomes the tab. Rooms & equipment is where a room is
   booked (the cell's **Book** for everyone — the `+` and its grant test are for people only),
   where its requests show (d.2), and where the owner reads everything on their resources. Rows
   are the resources, whether booked or not — a free room must be visible to be booked.

9. **Who may move or cancel a booking on a room or piece of kit.** The person who booked it
   (`requested_by`), for their own; the owner, for anything on their resource, with a reason the
   holder is told; and the `bookings:update` holders in reach, as today. This is the
   plain-reservation branch of `EditBookingDialog` — `I49.69` is corrected from *dead branch —
   remove* to *the booker's and owner's edit — untested*, and its browser test is written under
   this ADR (one who may, one who may not, refusals worded).

10. **"Requires approval" is retired.** The tick box goes from Admin → Resources in the same
    change; `deriveInitialState`'s `requiresApproval` arm goes with it; the column is dropped one
    release later once nothing reads it. `tentative` keeps its two remaining meanings —
    provisional by choice, and an exclusive clash written visible (ADR-0042 d.6) — and never
    again means *waiting for approval*.

11. **Every rule above is decided in the database** (ADR-0037): who may book (any tenant member,
    non-human resource, free slot — `book_resource`), who may answer (`decide_resource_request`),
    what an answer writes (the RPC, as the answerer), the shared-pair exception to the exclusion
    constraint (both rows `shared`, nothing else overlaps). The client mirrors only to word the
    form before submit. pgTAP: a team member books a free room and cannot book a taken one; the
    three request kinds route to the right answerer; a non-answerer cannot decide; a bump
    cancels exactly one booking and tells its holder; two `shared` bookings overlap and a third
    unshared one is refused; the fallback chain equals the notified set.

## Consequences

**Easier.** The common case — a free room — needs nobody and waits for nothing. The owner's inbox
carries conflicts only. One door for a room whether a task needs it or a person does. The
half-built approval flag stops pretending. A denied request never blocked anything, and a denied
requester always knows why and what to try next.

**Harder.** "Anyone books a free room" is a real widening: a team member can take the studio for
a week. The guard rails are visibility (the Rooms & equipment view, the audit) and the owner's
power to move or cancel with a reason. If the pilot shows a resource that must always be gated,
option E is the answer, not a return to the tick box. Sharing loosens the exclusion constraint for
marked pairs — the pgTAP case in d.11 is what keeps it to pairs. Three request types now live in
the inbox (assignment, extension, resource). One more daily sweep.

**Locked in.** A booking of a non-human resource is written only by its RPCs, as somebody with
authority — the requester never writes the row. `tentative` never means *waiting*. Owner is a
person, not a role. A request is never refused for want of someone to answer it, and never
expires silently. The task never waits for its kit.

**Not decided here.** A cost or charge on a room booking (`charge_rate` exists on `resources`).
Whether a booking carries the campaign it is for (`bookings.campaign_id` exists) — left to the
first pilot week. External resources and third-party access — no ADR yet; the nearest designed
work is M8 (joint projects) and M10 (client portal).

## Migration sketch (for sizing, not for approval)

- `20260917100000`: `resources.owner_id`; `bookings.requested_by`, `bookings.shared`; the
  exclusion constraint re-cut to exclude `shared`-pairs; `resource_requests` + RLS (tenant select;
  insert only through `book_resource`; update only through the RPCs); `resource_request_approvers`;
  `book_resource`; `decide_resource_request`; `withdraw_resource_request`; the moot-closing and
  supersede triggers; the pass-on sweep; notification types `resource_requested`,
  `resource_request_answered`, `resource_booking_bumped`, `resource_booking_shared`; pgTAP `1xx`.
- `subtask-schedule`: required resources through `book_resource`; the clash arm returns the
  choices instead of booking over.
- Client: the two tabs on `/schedule`; **Book** on a Rooms & equipment cell; the three-way
  conflict form; `ResourceRequestActions` in the inbox (accept / approve-and-bump / move / deny
  with reason); the task's resource-line states and the People-tab pill; Admin → Resources owner
  picker replacing the tick box; the requester's "where it stands" line.
- Browser tests (I49 rule): the member who books a free room and is offered three choices on a
  taken one; the holder who accepts a share and the colleague who cannot; the owner who bumps
  (confirm, holder told) and the non-owner who cannot; the `I49.69` edit/cancel pair.
- A later migration drops `requires_approval`.
