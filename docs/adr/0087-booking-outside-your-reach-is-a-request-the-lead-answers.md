# ADR-0087: Booking outside your reach is a request, and the resource's lead answers it

- **Status:** accepted (Edward, 11 Sep) — **d.1–d.3 and d.12 superseded in part by [ADR-0098](0098-a-lead-schedules-anyone.md) (22 Sep): a lead or an account manager schedules anyone; the request path stays only for a custom scope-grant role**
- **Date:** 2026-09-11
- **Open Decision:** none — Edward, 11 Sep, from the pilot
- **Task(s):** I45
- **Depends on:** [ADR-0037](0037-one-authorization-primitive-one-call-path.md) (the two primitives),
  [ADR-0040](0040-assigning-work-requires-authority-to-schedule-it.md) (assignment needs booking
  authority — this ADR builds the concept its last paragraph forecast),
  [ADR-0060](0060-booking-a-campaign-task-is-assigning-it.md) (booking a person is assigning a task,
  through `update_task_assignment` and nowhere else), [ADR-0073](0073-projects-manage-is-scoped-and-an-account-director-is-not.md)
  / [ADR-0074](0074-reach-across-every-account-is-a-setting-not-an-exception.md) (reach comes from
  scope, never from a role's name), [ADR-0082](0082-there-is-one-way-in.md) d.8 (the `+` on
  `/schedule` selects from existing projects). Relates to ADR-0014 (a self-scoped person books
  nothing), ADR-0036 (per-user scope grants), ADR-0070 d.6 (who is told about an approval, and who
  deliberately is not).

## Context

Edward, 11 Sep: *"I need to change the system to allow users with booking rights as follows. All
users can book within scope, i.e. team leads .. all team members. department leads all department
members... all users can book cross dept resources subject to the dept leads, or team leads
approval."*

That is two sentences, and they are not the same size. The first describes what the system already
does, measured below. The second describes something the system refuses today, at three separate
gates, and has never had a mechanism for — although ADR-0040 named the mechanism in its closing
paragraph a fortnight ago and then did not build it. **This ADR is about the second sentence.**

### "Within scope" — what `app.in_write_scope` already says

Booking authority has two axes (ADR-0037): the grant `bookings:create`, and reach over the resource,
answered by `app.resource_in_write_scope(resource)` → `app.in_write_scope(r.department_id,
r.team_id, null)`. The function as it stands (`20260906110000`) gives every reach a precise meaning
for a calendar, and they are read here from the code, not from the role descriptions:

| `roles.scope` | Held by (local seed) | Which calendars it reaches directly |
|---|---|---|
| `tenant` | Power Admin, Traffic Manager | every resource |
| `all_accounts` | Account Director | every resource (ADR-0074 — the branch returns `true` for every question) |
| `department` | Department Lead | resources in their department, and resources whose team sits in it (ADR-0014) |
| `team` | Team Leader, Deputy | resources in their team — **and a resource in their department that names no team** (ADR-0070 d.3's *"question asked with no team"* branch, which `resource_in_write_scope` reaches whenever `r.team_id` is null) |
| `account` | Account Manager | **none.** `resource_in_write_scope` passes `null` for the account manager, so the `account` branch is permanently false for a calendar — recorded in `write-scope.ts`'s header comment since I12.6 |
| `self` | Team Member, Client Portal | none (ADR-0014, Edward, 25 Aug: a self-scoped person books nothing, not even their own calendar) |

Plus, for everybody, the ADR-0036 overlay: a `user_scope_grants` row naming a department or team.

So *"team leads .. all team members. department leads all department members"* is what the
primitive does, and **nothing in this ADR widens or narrows it.** Two edges of the table are
wider or narrower than Edward's sentence and are flagged at the end rather than silently kept: a
team lead reaches a team-less colleague in their department, and an account manager reaches nobody.

### "Cross dept" — what happens today

Since ADR-0060, booking a person is assigning them a task, and since ADR-0082 d.8 the `+` on
`/schedule` picks a project's task rather than inventing ad-hoc work. So "booking a cross-department
resource" means, concretely: **opening `+` on a row in another department and giving that person a
task.** Every route that does this — the dialog's Project mode, the edit modal's reassign, a chip
dragged onto another row (`SchedulePage.tsx:241`, `schedule-api.ts:475/559`) — ends in one call,
`public.update_task_assignment`.

An out-of-reach caller is stopped before they get there, and again if they got there:

1. The grid's mirror (`useWriteScope` → `resourceInWriteScope`) declines to offer the control and
   shows `schedule.refusal.department` — *you can only book within your department*.
2. ADR-0040's trigger `app.tg_subtask_assignment_authority` raises `42501`: *"you cannot assign this
   task: X is outside the part of the organisation you can schedule."*
3. `bookings_scheduler_insert` refuses the materialised rows, which `booking-transition` renders
   as the 403 `out_of_scope`.

Each gate is correct on its own terms. Together they mean a Creative lead whose deliverable needs a
Production shoot has no route at all except asking Production, outside Maestro, to assign it
themselves — and the account manager, who holds `bookings:create` and `project_tasks:manage` and is
described in the seed as *"assigns/coordinates within their accounts"*, cannot assign anybody with
a calendar, by construction. ADR-0040 said so and said the fix was a grant. Nobody has been given
one: **`user_scope_grants` holds zero rows in the local tenant.**

### What already exists for "approval", and why it is not this

`bookings.state` has `tentative`; `bookings:approve` is a grant held by the leads, Power Admin and
the COO; `resources.requires_approval` (M4.2) sends a plain reservation to `tentative` when the
booker lacks `bookings:approve`; and `booking-transition` carries `approve` / `reject` transitions.
Three facts keep it from being the answer:

- **`tentative` already means three things.** The dialog offers it as *provisional* by choice
  (`BookingDialog.tsx:554`); ADR-0042 d.6 writes an exclusive clash as `tentative` so the
  requirement stays visible; and `requires_approval` uses it as the pending state. **0 of 7
  resources** in the local tenant set the flag, and `bookings:approve` occurs exactly once in the
  schedule feature — in a banner. A fourth meaning on the same word is how a chip stops saying
  anything.
- **A booking of a person is an assignment.** A `tentative` booking carrying `sub_task_id` with the
  task unassigned is precisely the half-built state ADR-0060 called a defect: a block on the calendar,
  a task assigned nowhere, a notification to nobody. Setting the assignee first, so the booking can
  be materialised, tells the person they have the work before the lead has agreed they do.
- **The requester cannot write the row.** `bookings_scheduler_insert` refuses them; getting a
  `tentative` row in would need a definer bypass on the bookings table itself, which is a larger
  hole than the one being closed.

ADR-0040's *Locked in* paragraph already said what the shape must be: *"Anything that wants to
assign without scheduling is asking for a different concept — a request or a proposal that the
assignee or a scheduler accepts — not a reason to let the two split again."* This is that concept.

### The precedent for not just opening it up

*"Everyone reaches everything"* has been tried. `20260820040000` blanket-granted the booking writes to
every internal role and stripped the scope test from all three policies for the alpha;
`20260823110000` reverted it three days later and moved the exceptions onto the ADR-0036 per-user
overlay. Edward's sentence says *"subject to … approval"*, which is not that, and the authorization
capsule's constraint stands: never decide from a role name, in Postgres or in the client.

### Options weighed

**A — widen `in_write_scope` and notify the lead afterwards.** Rejected. It is the alpha toggle
with a courtesy message, and the notification arrives after the person is already assigned.

**B — reuse `tentative` bookings and `bookings:approve`.** Rejected for the three reasons above.
Its one real merit — the transitions, audit and `sla_events` row already exist — is smaller than it
looks: the approve path runs as the caller through `bookings_scheduler_update`, so its effective
approver set is *`bookings:approve` ∧ `bookings:update` ∧ in scope*, which is a second definition of
"the lead" living beside the one this ADR needs, and they would drift.

**C — a request on the task, answered by whoever could have booked directly, which then runs the
ordinary assignment under the answerer's authority.** Chosen. It adds no second way to assign
(ADR-0060's *locked in*), it decides authority in the primitives and nowhere else (ADR-0037), and the
person on the receiving end is told once, when it is true.

**D — a per-user scope grant instead (ADR-0036).** Already built (`UserPermissionsDialog`), and kept —
as the answer for *standing* reach, not for the occasional case. See d.14.

## Decision

1. **"Within scope" is `app.in_write_scope` as it stands, and this ADR changes it in no way.** The
   table above is the definition. A team lead reaches their team, a department lead their
   department, a tenant-wide or all-accounts role everything, a per-user scope grant what it names.
   Restated so the first half of Edward's sentence is recorded as *confirmed*, not as *built*.

2. **Outside that reach, an assignment becomes a request instead of a refusal.** Decided in the
   database, inside the one assignment path: `update_task_assignment` tests the caller's reach over
   the assignee's calendar — the same test ADR-0040's trigger makes — and if it passes, assigns
   exactly as today; if it fails, records a request and assigns nothing. **The caller never chooses
   which.** The result says what happened (`assigned` or `requested`), the way ADR-0060's
   `reschedule_needed` already reports back. The client mirror (`resourceInWriteScope`) keeps one
   job: wording the dialog *before* submit — *"this will be sent to Production for approval"* —
   and being wrong there costs nothing, because the server decides.

3. **What the requester must hold is everything ADR-0040 requires except reach over the calendar.**
   `project_tasks:manage` and `app.in_write_scope` over the task as it stands (the gate
   `update_task_assignment` already applies, ADR-0060 d.9), and `bookings:create`. A Team Member —
   `self`, no booking grant — cannot request, exactly as they cannot book (ADR-0014). Edward's
   words are *"users with booking rights"*, and this is what that phrase means in the system.

4. **The record is a row, not a state on the task.** A new table `sub_task_assignment_requests`:
   tenant, sub-task, proposed assignee, requested by / at, the assignment payload
   (dates, hours, reviewers, review mode — what `update_task_assignment` would have written),
   status (`pending` · `approved` · `refused` · `withdrawn` · `superseded`), decided by / at, and an
   optional reason. **At most one pending request per task.** RLS, `force row level security` and
   the audit trigger in the migration that creates it (AGENTS.md §6). **Nothing on the task changes
   while the request is pending**: no assignee, no dates, no reviewers, no bookings. A refused
   request stays as a record of who asked, whom, and who said no.

5. **Who may decide: whoever could have made the booking directly.** `app.has_permission('bookings',
   'create')` and `app.resource_in_write_scope(<the proposed assignee's resource>)`, evaluated for
   the *caller* through the primitives and nowhere else. That is the department lead by department
   reach, the team lead or deputy by team reach, *either* of them — Edward's *"dept leads, or team
   leads"* — and the first decision closes the request. A tenant-wide or all-accounts holder passes
   too, as the failsafe ADR-0070/0073 already establish; so does a per-user scope grant over that
   department or team. **No role is named**, in SQL or in the client, and `bookings:approve` is
   deliberately *not* required: it belongs to the `requires_approval` reservation flow, and tying a
   second meaning to it would give this rule two homes. The requester cannot answer their own
   request, because if they passed this test they would not have needed to ask.

6. **Who is told: the leads whose role reach covers the resource, and not the agency-wide roles.**
   Department-scoped holders in the resource's department; team-scoped holders in its team, or —
   for a resource naming no team — in its department, so that the notified set equals the deciding
   set under the current primitive. Tenant-wide and all-accounts holders are *not* notified, for
   ADR-0070 d.6's reason: they can approve anything and would otherwise receive every request in the
   agency; that is what keeps them a fallback and not a queue. Per-user scope-grant holders are not
   notified either, on I40.15's ground — a scope grant says what somebody may write, not whose
   request they answer for; they may still decide. Computed the way
   `public.department_brief_approvers` is — `app.user_has_permission` plus the scope test mirrored
   in the query — with the same anti-drift assertion test `090` carries. New notification type
   `assignment_requested` on entity `sub_task`, with EN and AR inbox copy *and* email copy, because
   the constraint's own comment records that both have been missed more than once.

7. **Approval IS the assignment, done by the approver.** Approving applies the request's payload
   through the ordinary assignment path as the approver — ADR-0040's trigger passes for them, the
   task's department follows the assignee (ADR-0060 d.9), the existing `assigned` notification
   reaches the person with the approver as actor — and then `subtask-schedule` runs as the approver
   and materialises the bookings `confirmed`, as any direct assignment does. The requester is told
   `assignment_approved`. **This is the one clause that combines two people's authority, and it is
   flagged rather than buried:** the request holds the task half (d.3, tested when it was made) and
   the approval supplies the calendar half (d.5, tested when it is answered); together they are the
   authority ADR-0040 requires of one person. The approver is *not* re-tested against the task's
   own scope — a Production lead answering for a Creative deliverable's task does not hold Creative —
   because that half was already held by the person who asked, and the record says so.

8. **Refusal changes nothing but the record.** Status `refused`, an optional reason, the requester
   told `assignment_refused`. The task stays exactly as it was; the requester may ask somebody else
   or ask again. There is no appeal mechanism, because the failsafe roles already are one.

9. **A request can be withdrawn by the requester, and is closed automatically when it no longer
   applies** — the task is assigned by another route, cancelled or done, or the proposed person
   stops being bookable (ADR-0061 d.5). Closed as `superseded`, with the requester told only in the
   assigned-by-someone-else case, since the others are already visible to them.

10. **A pending request holds no capacity.** No booking exists, so nothing counts — which is also
    why the grid's overload arithmetic (`drop-check.ts` reads `confirmed` only) needs no change.
    Holding the slot was weighed and rejected: capacity is consumed by agreed work, and a request
    the lead has not seen would otherwise reduce what they can give out in their own department.
    What the approver needs is the number: the request shows the person's load for the requested
    days — the ADR-0018 badge, on the week the work would land, as ADR-0083 d.10 does for intake —
    so the decision is taken with the cost in view. On approval the ordinary warn-and-allow applies
    (ADR-0061 d.2): an over-ceiling day asks, never refuses.

11. **The requester sees where it stands, and the approver has no dead end.** The task shows
    *awaiting approval from <department>* wherever its status is shown; the grid draws a
    **requested** chip on the person's row for the requested days — from the request, not from a
    booking, visually distinct from *provisional*, counting toward nothing. The approver decides
    from the inbox, from that chip, or from the task, and each is a second door into the same
    action, not a second implementation (ADR-0080 d.10's phrase).

12. **The same rule on every route.** Dialog, edit-modal reassign, cross-row drag: all three end in
    `update_task_assignment`, so all three become a request when the target is out of reach and
    none of them needs its own logic. A dragged chip stays where it was until the request is
    answered.

13. **A request to a resource nobody scoped can reach is refused, not queued.** A resource with no
    department and no team is reachable only by tenant-wide and all-accounts roles, who are not
    notified (d.6); a request on it would wait for nobody — the deadlock ADR-0070 refused to build.
    So it is refused at request time with the `schedule.refusal.unplaced` reason that already
    exists, and the fix is to place the resource. **Measured: all 7 active human resources in the
    local tenant are unplaced**, so on that seed this clause fires every time — the live tenant must
    be measured before this ships (see Consequences).

14. **Standing reach stays a scope grant.** A lead who is approving the same requester every week
    has the answer in `UserPermissionsDialog` (ADR-0036): a scope grant over the department, audited
    and revocable, after which that person's bookings stop being requests. This ADR does not build a
    ceiling, a cooling-off or a "you have asked too often" — ADR-0073 d.7's judgement, *audited not
    restricted*, is adopted rather than re-argued.

15. **What is deliberately untouched.** `app.in_write_scope`, `app.resource_in_write_scope`, the
    three `bookings_scheduler_*` policies, ADR-0040's trigger, the `tentative` state,
    `resources.requires_approval` and its reservation flow, ADR-0029's PM bypass
    (`caller_is_booking_pm`, sitting on the booking policies and consulted by nothing else — 0 jobs
    in the local tenant name an owner), plain reservations of equipment and rooms through
    `booking-transition`, and ad-hoc creation — which ADR-0082 d.8 is retiring and this ADR does
    not extend, so `create_adhoc_deliverable` keeps refusing out of reach until it is gone.

## Consequences

**Easier.** The cross-department case gets a route inside the product for the first time: a
Creative lead gives a Production shoot to a Production person and Production's lead says yes or no
with the person's week in front of them. The account manager — who has never been able to complete
an assignment (ADR-0040's measurement) — gets one without anyone handing out a grant: every
assignment they make is a request to the department that owns the person, which is the same shape
as *the department approves its own brief* (ADR-0070). Three refusals become one request. And the
person on the receiving end is told exactly once, when it is true.

**Harder.** One more table, three notification types with copy in two languages and email, an
approval surface on the task and on the grid, and a request chip the schedule API has to fetch from
somewhere other than `bookings`. d.7 combines two people's authority and is auditable only because
the row records both halves — a request approved by the wrong person would be a real authority
failure, which is why d.5 evaluates through the primitives and test `090`'s anti-drift shape is
reused. d.10 means a pending request is invisible to capacity: two requests for the same person's
same days can both be pending and both be approved, and the second approval gets the over-ceiling
warning rather than a refusal — the ordinary rule, but worth knowing. **And d.13 must be measured
on the live tenant before this ships**: if its people are unplaced the way the local seed's are,
the feature refuses every request on day one and the work to do first is placement, not code.

**Two edges flagged for Edward, kept as they are.** *(a)* A team lead reaches a team-less colleague
in their own department directly, without a request — ADR-0070 d.3's branch, read through
`resource_in_write_scope` for any resource whose `team_id` is null. Wider than *"team leads .. all
team members"*; left alone here because narrowing it is a change to the primitive and one decision
per ADR. *(b)* An account manager reaches no calendar at all, so under this ADR every **booking on
`/schedule`** they make is a request. **Edward, 11 Sep, correcting the first draft of this edge:**
*"The AM can assign people directly when it comes to the campaign brief and assigning deliverable
owners, this is not optional… only bookings on /schedule need approval… the booking should be
displayed but subject to confirmation."* The two are different acts and this ADR governs only the
second. **Naming a deliverable's OWNER** — in the wizard, on SJ-02 (ADR-0083 d.8), on the campaign
page — is not a booking: it writes `deliverables.owner_user_id`, places nothing on anybody's
calendar, consumes no capacity, and it stays the account manager's to do directly, with no request
and no approval. **Placing a person on the schedule** is the booking, and for an AM that is always
outside reach and always a request — displayed on the grid as d.11 says, pending the lead's
confirmation. The alternative of reading the campaign's account manager into
`resource_in_write_scope` so an AM books directly on their own campaigns was weighed and not chosen:
it would let an AM occupy a department's people without the department's say, which is the opposite
of ADR-0070's direction.

**Locked in.** That reach is decided by `in_write_scope` and nowhere else, and that a refusal from
it is now the *beginning* of a request rather than the end of an attempt. That assignment happens
through `update_task_assignment` and nowhere else, including when it happens on approval. That
authority over somebody's time can be held by two people and joined by a record, but never
inferred from a role's name. And that a pending request holds nothing — capacity belongs to agreed
work.

**Migrations and tests.** One migration: the table with its RLS and audit trigger, the notification
types, `update_task_assignment` re-emitted whole per the house pattern (a bare `create or replace`
drops the ADR-0033 `search_path` pin) with the request branch, the decide RPC, the approver-listing
function, and the close-on-supersede trigger. pgTAP, at least: a Creative lead assigning a
Production person produces a `pending` row and no assignee (allow and deny on the new table's
policies); the same lead cannot answer it; a Production lead approving produces the assignment with
the department stamped from the assignee, the `assigned` notification to the person and
`assignment_approved` to the requester; a refusal leaves the task byte-identical; a request on an
unplaced resource is refused; a second pending request on the same task is refused; the notified set
equals the deciding set minus tenant-wide and all-accounts holders (the `090` shape); and test `048`
passes **unmodified**, because the trigger it asserts is untouched and remains the guard on every
write path that is not this RPC. Unit: `write-scope.test.ts` gains the dialog-wording cases;
`schedule-api.test.ts` the request-chip fetch.

**Not decided here.** Whether a required resource (ADR-0042 — a camera the task needs) in a third
department should raise its own request when the task is approved, or stay an `unplaced` line in
the materialiser's report as it is today. Whether `approved → delivered` and the other container
transitions should close pending requests the way d.9 closes them on cancellation. Whether the
edge (a) above should be narrowed. Each is its own decision.

## Addendum — 11 Sep, from the independent review

**A request is raised only for work the approval could assign.** The request branch of
`update_task_assignment` returned before any `sub_tasks` write, so `tg_sub_task_assignment_gate`
never ran for the requester: on a single job whose list the owner had not approved (ADR-0090), or
a campaign the account manager had not approved (ADR-0048 d.8), the request was recorded and the
leads notified — and the lead's approval was then refused. d.11 promises the approver no dead end.
The two gates are now asked at request time, in the trigger's own words (`20260911130500`).

**The client mirror's team branch matched an older `in_write_scope`.** ADR-0070 d.3 lets a
team-scoped caller answer a question that names no team by the department their team sits in;
`write-scope.ts` required the named team, so a team lead was told a booking of a team-less
colleague in their own department "will be sent for approval" and the grid hid Approve/Refuse from
the very lead the server had notified. The mirror now says what the server says.
