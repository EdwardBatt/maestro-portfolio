# Notification email copy — draft for review

**Status:** DECIDED one action at a time on 17 Sep (the blocks under *Decided one action at a time*); the tables below them are the superseded 6 Sep draft. Nothing decided is in the product yet — building is the next step.
**Raised:** 6 September 2026 — *"email notifications that are being set are very sparse… messages
should contain better more descriptive information."*
**Lands in:** `supabase/functions/notify-email/index.ts` (the `COPY` map), once approved.

---

## Decided one action at a time — 17 Sep (Edward)

Edward, 17 Sep: *"None of the messages are clear on what is actually required. And some are wildly
inaccurate."* The method from here: **one action → its recipient → the exact words**, with real
values, decided one at a time. Each block below is a decision; the tables further down are the old
draft and are superseded wherever a block exists.

### Action 1 — the account manager approves a campaign / releases a single job

- **Recipient:** the **deliverable's owner** (typically the department or team lead). Nobody else —
  not department leads by role, not reviewers. (Today: owners + every department lead + reviewers,
  and the words say "its work can be assigned now", which contradicts ADR-0070 d.4.)
- **Subject:** `Approved: <campaign or job title> — you own <n> deliverable(s)` *(I53.19, Edward,
  21 Sep: ONE mail per owner, however many deliverables they own — the walk of 21 Sep showed one
  owner four identical mails)*
- **Body:** `<approver's name> approved <campaign or job title>. You own <n> deliverables on it:`
  then one line per deliverable — `• <name> — Phase <n>: <phase name>, due <day>` (no phase on a
  campaign without phases) — then `You need to review the task list of each, then approve it so
  each task can be assigned.` *(Edward, 21 Sep: the phase and date per piece, in the list. Edward,
  24 Sep: "only task lists" — department briefs are retired, ADR-0100.)*
- **Button:** opens the campaign (or the job, whose page points at its one deliverable).
- **Same words for a campaign and a single job.** Facts line: the earliest due date of theirs.

### Action 2 — a deliverable's owner is changed (trigger `app.tg_deliverable_owner_notify`, on `deliverables.owner_user_id`; the *Change owner* control on the Deliverables page)

- **New owner** — **Subject:** `Assigned to you: <deliverable> — <campaign or job title>`
  **Body:** `<changer's name> made you the owner of <deliverable> on <campaign or job title>. You need
  to review the brief and tasks and then approve so each task can be assigned.` **Button:** the deliverable.
- **Old owner** — told, one line. **Subject:** `No longer yours: <deliverable> — <campaign or job title>`
  **Body:** `<deliverable> on <campaign or job title> is now owned by <new owner's name>.` No button needed
  beyond the deliverable.
- Never the person who made the change. (Today: both parties, one neutral sentence — decided 17 Sep.)

### Action 3 — a task is assigned to someone (trigger `app.tg_subtask_notify_assignee`, on `sub_tasks.assignee_id`; from the Schedule's `+`, the add-task picker, an approved booking request, Reinstate-and-assign)

- **The assignee** — **Subject:** `New task: <task title>`
  **Body:** `<assigner's name> assigned you <task title> on <campaign or job title>. It is due <day, date>
  and estimated at <n> hours. Start it from My Work and submit it for review when it is done.`
  **Button:** the task on My Work.
- **The person who lost it** (a reassignment) — told, one line. **Subject:** `No longer yours: <task title>`
  **Body:** `<task title> on <campaign or job title> has been reassigned to <new assignee's name>.`
  (Today: nothing — a new emitter is needed for the old assignee.)
- Never the person who assigned it.

### Action 4 — the maker submits a task for review (trigger `app.tg_subtask_notify_reviewer`, status → `review`; plus `tg_sub_task_reviewer_appointed_in_review` for a reviewer named after submit)

- **It is the TASK being reviewed, so the task title is the name** (Edward, 17 Sep). Today the trigger
  writes the deliverable's name — a fault to fix, not wording. The button opens the task's review.
- **Required reviewer** — **Subject:** `Review needed: <task title>`
  **Body:** `<maker's name> submitted <task title> on <campaign or job title> for your review. Open it,
  review the work, and approve it or send it back with your changes.`
- **Optional reviewer** — **Subject:** `Your feedback is needed: <task title>`
  **Body:** `<maker's name> submitted <task title> on <campaign or job title>. Open it and leave your
  feedback, or mark it "no comment" — the approval waits for your answer.`
  (Today both get the same words; the mail needs to know which kind of reviewer the recipient is —
  `sub_task_reviewers.is_mandatory`.)
- Never the maker.

### Action 5 — a reviewer sends the task back (`sub_task_request_changes`, *Request changes* on the review)

- **The assignee** — **Subject:** `Changes requested: <task title>`
  **Body:** `<reviewer's name> sent <task title> on <campaign or job title> back with feedback. Open it,
  make the changes and resubmit for review.`
  **Button:** the task on My Work.
- The reviewer's comments are **never in the mail or the in-app notification** — the mail points to
  them (Edward, 17 Sep). Never the reviewer.

### Action 6 — the required reviewer approves the task (`app.complete_sub_task_if_approved` → `done`; then `app.notify_dependents_ready`, ADR-0069 d.4)

- **6a — the assignee of the approved task** — **Subject:** `Approved: <task title>`
  **Body:** `<reviewer's name> approved <task title> on <campaign or job title>. Nothing more is needed
  from you on it.` No facts line (a due date on finished work is noise). **Button:** the task on My Work.
- **6b — the assignee of each task that listed the approved one as a required input**, sent only when
  that task now has nothing else outstanding (the existing once-when-the-last-clears rule) —
  **Subject:** `You can start: <waiting task title>`
  **Body:** `<approved task title>, which <waiting task title> on <campaign or job title> was waiting
  for, has been approved. Everything it needs is now in — start it from My Work.`
  **Carries a link to the approved file** (Edward, 17 Sep) — the approved version, opened in Maestro
  (a signed storage URL expires and is scanner-bait; the in-app link serves the download).
  **Button:** the waiting task on My Work.
  (Today the label names the WAITING task and the approved one is never named — fix.)
- **6b, waiting task with no assignee:** the **deliverable's owner** is told instead, same words plus
  *"It is not assigned to anyone — assign it on the Schedule."* (Today: nobody — fix.)
- Never the reviewer.

### Action 7 — a task is cancelled (`sub_task_cancel`; *Remove* on a task with history, ADR-0052 d.13; archiving the job, ADR-0080 d.4)

- **The assignee** — **Subject:** `Cancelled: <task title>`
  **Body:** `<canceller's name> cancelled <task title> on <campaign or job title>. Stop work on it — it
  has been taken off your calendar and nothing more is needed from you.`
  When the job was archived: `… because <campaign or job title> was archived.` appended.
  No facts line. **Button:** My Work.
- Unassigned tasks tell nobody. Never the person who cancelled it.

### Action 8 — a task's booking is moved to different days (`app.tg_booking_notify_reschedule`; a drag on the Schedule; moving your own work tells nobody)

- **The assignee** — **Subject:** `Moved: <task title>`
  **Body:** `<mover's name> moved <task title> on <campaign or job title> to <first day> – <last day>.
  Its due date is unchanged: <day, date>.` — or `… and it is now due <day, date>.` when the due date
  moved with it.
  **Button:** the Schedule, on that week.
- The mail reads the booking's new days and the task's due date (today it names neither — fix).

### Action 9 — a deadline extension is asked for and answered (`request_task_extension` → the campaign's account manager, failsafe Traffic / Power Admin / Account Director; `decide_task_extension` → the requester and the assignee, ADR-0088 d.9)

- **9a — request, to the account manager** — **Subject:** `Extension to answer: <task title>`
  **Body:** `<requester's name> asked to move the deadline of <task title> on <campaign or job title>
  from <day, date> to <day, date>. Reason: "<reason>". Open it and approve or refuse.`
  **Button:** the task in its deliverable. (Today: neither date nor the reason is in the mail — fix.)
- **9b — approved, to the requester and the assignee** — **Subject:** `Extension approved: <task title>`
  **Body:** `<decider's name> approved the extension. <task title> on <campaign or job title> is now
  due <day, date>.`
- **9c — refused, to the requester and the assignee** — **Subject:** `Extension refused: <task title>`
  **Body:** `<decider's name> refused the extension. <task title> on <campaign or job title> is still
  due <day, date>. Reason: "<reason>".`
- **Button** for 9b/9c: the task on My Work. The reason is a short typed field and IS included
  (unlike review comments). Never the actor.

### Action 10 — a booking outside reach is requested and answered (ADR-0087: `update_task_assignment` records the request → the leads in reach of the person; `decide_assignment_request`; the close-when-moot trigger). **Since ADR-0098 (22 Sep) no lead and no account manager raises one** — they book anyone directly, and the person's own lead is not told (Edward: *"not told"*). The three mails below stay for a custom scope-grant role booking beyond its grant.

- **10a — request, to the person's leads** — **Subject:** `Booking request: <task title>`
  **Body:** `<requester's name> asks to book <person> on <task title> (<campaign or job title>),
  <first day> – <last day>, <n> hours. Nothing is booked until you approve it — open the Schedule to
  approve or refuse.` **Button:** the Schedule on that week, the person searched.
  (Today: neither the person nor the days are in the mail — fix.)
- **10b — approved, to the requester** — **Subject:** `Booking approved: <task title>`
  **Body:** `<decider's name> approved your request. <person> is booked on <task title>,
  <first day> – <last day>.`
- **10c — refused, to the requester** — **Subject:** `Booking refused: <task title>`
  **Body:** `<decider's name> refused your request to book <person> on <task title>. Reason:
  "<reason>". The task is unchanged — ask somebody else.`
- **10d — closed, to the requester** — **Subject:** `Booking request closed: <task title>`
  **Body:** `<task title> was assigned to <person> by <assigner's name>, so your request for it is closed.`
- **Button** for 10b–d: the Schedule on that week. Never the actor.

### Action 11 — the last optional reviewer answers (`sub_task_reviewer_respond`, ADR-0089 d.9)

- **Each required reviewer whose approval is still owed** — **Subject:** `Ready for your approval: <task title>`
  **Body:** `Every reviewer has answered on <task title> (<campaign or job title>) — <n> with feedback,
  <m> with no comment. Open it, read the feedback, and approve it or send it back.`
  **Button:** the task's review. (Today the label is the deliverable's name — fix, as Action 4.)
- The feedback stays in the thread. Never the reviewer who answered.

### Action 12 — someone is added to a chat group (`chat` Edge Function, *add member*)

- **The person added** — **Subject:** `Added to a chat group: <deliverable or task or campaign> — <campaign or job title>`
  **Body:** `<adder's name> added you to the chat group for <deliverable or task or campaign> (<campaign or
  job title>). Open it to read the thread and reply.`
  **Button:** the thread itself, in Chat (today: the deliverable — fix).
- It is not an invitation and asks for no reason field — they are in the group (Edward, 17 Sep).

### Action 13 — a person is booked on a task as a required resource (`app.tg_booking_notify_resource`, ADR-0042; not the assignee, never equipment)

- **The person booked** — **Subject:** `You're booked on: <task title>`
  **Body:** `<booker's name> booked you on <task title> (<campaign or job title>), <first day> –
  <last day>, <n> hours. <assignee's name> is doing the task; you're needed on it for that time —
  it's on your calendar.`
  **Button:** the Schedule on that week, the person searched. (Today: My Work, where the task is
  not — fix.)

### Action 14 — a resource cannot be booked cleanly (`raise_resource_clash`; replaced by ADR-0094 / I50 when built)

- **Whoever assigned the task, and the account manager** — **Subject:** `Booking clash: <resource>`
  **Body:** `<resource> is needed for <task title> (<campaign or job title>) on <first day> – <last day>
  but is already booked then. Open the Schedule to move the task or pick another resource.`
  **Button:** the Schedule, that week, the resource searched.

### Action 15 — a new request is attached to an existing job (`attach_job_to_campaign`, SJ-A1 → attach, ADR-0086 d.7)

- **The new deliverable's owner** — **Subject:** `Added to <campaign or job title>: <new deliverable>`
  **Body:** `<AM's name> added <new deliverable> to <campaign or job title> — a new request that belongs
  with that job. You need to review the brief and tasks and then approve so each task can be assigned.`
- ~~**Another existing owner on the job** (a different person) — one line:
  `<new deliverable> was added to <campaign or job title>; <new owner's name> owns it.`~~
  **Dropped 21 Sep (Edward, I53.18):** *"existing owners should only be notified of changes to
  their existing deliverables"* — the same rule as Action 16. Nobody but the new owner is told.
- **Button:** the new deliverable.

### Action 16 — a deliverable is added to a RELEASED campaign (`add_campaign_deliverable`: *Add deliverable*, *Propose more*; I53.18, Edward, 21 Sep)

- **The new deliverable's owner, and nobody else** — Edward: *"existing owners should only be
  notified of changes to their existing deliverables"*. Action 15's words: **Subject:** `Added to
  <campaign>: <new deliverable>`; **Body:** `<AM's name> added <new deliverable> to <campaign> — a
  new request that belongs with that job. You need to review the brief and tasks and then approve
  so each task can be assigned.` **Button:** the new deliverable.
- A proposal the account manager does not give an owner and a date is never added, so never mailed.
- On a campaign still pending approval: nothing now; Action 1 tells the owner at approval.

### `blocked` — removed

Nothing has ever raised it: no trigger or function inserts the type. ADR-0069 replaced "blocked" with
a named required input and ADR-0030 dropped the status. The type leaves the constraint, the copy map
and the inbox strings (Edward, 17 Sep).

### Not done yet in this pass

`campaign_approved` for the account manager's own dashboard? — n/a (the AM approves). `due_soon` —
never emails by design (ADR-0028). `brief_awaiting_approval` — fires only when a brief already exists
at approval time, which never happens (briefs are generated after approval); folded into Action 1.
Task reinstated — decided earlier today (I52.7): *Needs assigning* to the leads in reach and the
deliverable's owner, opens the Schedule.

## How to use this document

Edit the **Subject**, **Line 1** and **Line 2** columns directly. Keep `{label}` and `{actor}`
exactly as written — they are filled in at send time:

- `{label}` — the thing the notification is about. What it resolves to differs by type and is noted
  per row where it matters.
- `{actor}` — the person who did it. Falls back to *"A teammate"* when the system did it rather
  than a person.

**Line 2 is new.** The email template renders one sentence today; adding a second is a small change
to the renderer and every type benefits. If you would rather keep emails to one sentence, delete the
Line 2 column and say so — the drafts still work, they just stop saying where to go.

Once the English reads right, the Arabic is written from it. Translating copy that is about to be
rewritten is wasted work, so it is deliberately not here yet.

---

## 1. Work coming to you

| Type | Subject | Line 1 | Line 2 |
|---|---|---|---|
| `assigned` | New task: {label} | {actor} has assigned you to "{label}". | It's on your My Work page, with its due date and anything it's waiting on. |
| `resource_required` | You're needed on: {label} | {actor} has put you on "{label}" as a required person. | You're not the owner — open My Work to see what's being asked of you and when. |
| `dependency_ready` | You can start: {label} | {actor} finished the task "{label}" was waiting on, so it's no longer blocked. | It's ready to pick up now on your My Work page. |
| `task_reinstated` | Back on: {label} | {actor} has reinstated "{label}" after it was cancelled. | It's unassigned until somebody picks it up — open My Work if it's yours to take. |

## 2. Review and approval

| Type | Subject | Line 1 | Line 2 |
|---|---|---|---|
| `review_requested` | Ready for your review: {label} | {actor} has submitted "{label}" and it's waiting on you. | Open it from "Awaiting my review" on My Work to approve it or request changes. |
| `changes_requested` | Changes requested on {label} | {actor} has reviewed "{label}" and asked for changes. | Their notes are on the task — open My Work to see what they've asked for. |
| `signed_off` | Signed off: {label} | {actor} has signed off "{label}". Nothing further is needed from you. | Open it to see the approved version. |
| `brief_awaiting_approval` | Your department's brief needs approval: {label} | {actor} approved the campaign "{label}", and your department's brief is ready for you to read. | No work on it can be assigned until you approve it — open the campaign to review it. |
| `campaign_approved` | Campaign approved: {label} | {actor} has approved "{label}", so its work can now be assigned. | Open the campaign to see each department's brief and what's outstanding. |

## 3. Changes to work you are on

| Type | Subject | Line 1 | Line 2 |
|---|---|---|---|
| `blocked` | Blocked: {label} | {actor} has marked "{label}" as blocked, so it can't move until whatever it's waiting on clears. | Open My Work to see what's holding it and who's on it. |
| `rescheduled` | Moved: {label} | {actor} has moved "{label}" to different days. | Your schedule has changed — open My Work to see the new dates. |
| `cancelled` | Cancelled: {label} | {actor} has cancelled "{label}". Nothing further is needed from you. | If you'd already started, your time on it is still recorded. |
| `deliverable_reassigned` | Owner changed: {label} | {actor} has changed who owns "{label}". | Open it to see who's accountable for it now. |

## 4. For the person running it

| Type | Subject | Line 1 | Line 2 |
|---|---|---|---|
| `resource_clash` | Booking clash: {label} | {actor} scheduled work that clashes with {label}'s existing bookings. | Nothing was double-booked silently — open the Schedule to move one of them. |
| `chat_added` | You've been added to the discussion on {label} | {actor} has brought you into the conversation about "{label}". | Open Chat to catch up and reply. |

`due_soon` is deliberately absent: it is a digest concern (ADR-0028) and the deadline sweep that
would raise it is not built.

---

## Three decisions this needs

Tick or strike. Each is a change beyond the wording, and none is made yet.

- [x] **1. Add a second line to the email template. ANSWERED 8 Sep — built (`I30.8`), but NOT as
  drafted.** Edward took the recommendation that a second line must carry *facts*, not directions:
  the drafted lines pointed at a page the button already opens. It is now **generated** — the due
  date and the hours, read from the work itself. **You no longer write Line 2 per type.** The Line 2
  column below is kept only as a record of what was proposed.

- [x] **2. Point `resource_clash` at the Schedule. ANSWERED 8 Sep — built (`I30.8`).** It also
  arrives with that resource already searched for and the right week open.

- [x] **3. Make a booking-driven assignment name the TASK, not its deliverable. ANSWERED 8 Sep —
  built (`I30.7`).** This is why an
  email read *"has assigned you to 'Creative'"*: when a booking is made against a deliverable the
  label is the **deliverable's** name, so the email can name a container rather than the work.
  Only the sub-task path uses the task title. Changing it means editing the emitter in
  `20260826130000`, which is a migration rather than copy.

---

## Every label carries its campaign (`I30.7`, 8 Sep)

Edward: *"any reference to a deliverable should always also include the Project/Campaign title."*
The campaign is resolved from the notification's own entity when it is written, and rendered in
front of the work as **`Campaign — Work`**. Three cases deliberately show the work alone: **ad-hoc**
work, which has no campaign and gets no invented prefix; a **campaign** notification, which would
otherwise read "Spring Launch — Spring Launch"; and **`resource_clash`**, whose label is a person or
a piece of equipment and is not in a campaign at all.

When editing below, assume the campaign is already there. A sentence that repeats it will read
"Spring Launch — Hero KV for campaign Spring Launch".

## What each `{label}` actually resolves to

Worth knowing while editing — a sentence that reads well against a task title can read oddly
against a resource name.

| Type | `{label}` is |
|---|---|
| `assigned` | the task's title. (Until 8 Sep this was the DELIVERABLE's name when the assignment came from a booking — decision 3, now fixed.) |
| `resource_required` | the deliverable's name, falling back to the task's title |
| `resource_clash` | **the resource** — the person or thing that could not be booked cleanly, not the work |
| `campaign_approved`, `brief_awaiting_approval` | the campaign's name |
| `deliverable_reassigned` | the deliverable's name |
| everything else | the task's title |

## Where the button goes

The email carries one button, *"Open in Maestro"*. Since 26 Sep (`I59.45`, Edward: *"all emails sent must provide
accurate links to the action required"*) it opens **where the action is**, from ONE table shared with the in-app bell:
`src/lib/notifications/door.ts`. Change a door there, never in `notify-email` or `NotificationInbox`.

| The email is about | The button opens |
|---|---|
| the reader's own task — new, changes requested, approved, extension answered, unblocked, kept, nudged, a reply, re-opened, sent untimed, you can start | the **task page** `/my-work/task/<task>` |
| a review — review needed, feedback needed, ready for your approval, reminder | My Work, the **review card** marked |
| something answered on a **Needs you** card — a question, too much, blocked, an extension at the reader's step (owner or account manager), a change request (to answer, declined, pushed back), an escalation, over capacity | My Work, **that card** marked (`?task=<task, deliverable, person or notification>&kind=<card>`) |
| a task list to approve, or a deliverable to read — added, made owner, no longer owner, re-opened, campaign approved, change accepted or withdrawn | the **campaign page** (its task-list panel); the bell, which does not know the campaign, goes through `/campaigns/piece/<deliverable>` |
| assigning — you can start with nobody on it, nobody assigned yet | the **Schedule**, on the campaign and department |
| a booking request, clash, required person, moved booking, reinstated task | the **Schedule**, on the week and the person |
| a chat group | that chat group |
| a cancelled task, or one reassigned away | My Work |

Checked 26 Sep on the local stack: one notification of every type inserted, each email read from Mailpit, every
button compared with the table above; and My Work marked the linked card (review, new on you, change request).
