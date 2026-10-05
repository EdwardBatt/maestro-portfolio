# ADR-0139: A booking outside your own team is a request to that team's lead

- **Status:** accepted (Edward, 3 Oct) — records Edward's answers of 3 Oct
- **Date:** 2026-10-03
- **Open Decision:** none
- **Supersedes:** ADR-0098 d.1, d.5, d.6, d.7 (a lead, account manager or account director schedules anyone directly)
- **Amends:** ADR-0087 (the request now names a team, and the person is optional); ADR-0060 addendum 22 Sep
- **Task(s):** I74.1–I74.6

## Context

Edward, 3 Oct, mapping the Schedule rework (Figma section L, `1830:934`, frames SC-01…SC-30): *"Assigning someone from
another department is a request to the team lead of the user who is being requested, when there is no team lead it is
directed to the dept lead."*

Today (ADR-0098, on production since 22 Sep) `app.resource_in_scheduling_scope` is true for every `department`, `team`
and `account` scope over every active resource: any lead and any account manager books anyone, and the person's own
lead is not told (d.7). The Figma draws the opposite: a team lead's Schedule shows only her own team ("Her people aren't
on your grid — only your team is"), and a task for another team becomes an *ask* the other lead answers (SC-15, SC-18,
SC-28–SC-30), with 4 working hours before it "goes to traffic".

ADR-0087's request machinery is still built (`sub_task_assignment_requests`, the request branch in
`update_task_assignment`, `decide_assignment_request`, `withdraw_assignment_request`, the notification types) but since
ADR-0098 no seeded role reaches it, and it names a specific assignee and notifies every scoped lead at once.

Edward's answers, one at a time:

| Question | Chosen | Rejected |
|---|---|---|
| Ask for a person or a team? | **Filter to the team, then pick the person or let the team lead choose** | person only; team only |
| What counts as "outside"? | **B: any team other than your own** — also inside your department | only another department |
| Who still books directly? | **C:** a team lead within her team; a department lead within his department; **Traffic and Power Admin anyone**. Account managers and the account director ask | only team leads change; everyone except leads asks |
| Nobody answers | **B: after 4 working hours, Traffic and the department lead are both told; the first to act settles it** | Traffic alone; it books itself |
| A team with a Team Leader and a Deputy | **B: the Team Leader is asked; the Deputy only when the Team Leader is on leave that day** | both, first answer wins |

## Decision

1. **Who books directly.** A **team lead** books the people of her own team; a **department lead** books anyone in his
   department; **Traffic and the Power Admin** book anyone. Everyone else — an account manager, the account director, a
   team lead outside her team, a department lead outside his department — sends a **request**. A self-scoped person
   books nobody (ADR-0014, unchanged). `app.resource_in_scheduling_scope` narrows to this; every reader ADR-0098 d.2
   moved to it follows.
2. **A request names a team, and the person is optional.** The asker filters to a team, then picks one of its people
   or leaves it to the team lead ("Amira decides"). It carries the task, the hours, the needed-by date and a note; the
   piece's brief and files go with it. Nothing is booked until it is answered.
3. **Who answers.** The **Team Leader** of the requested team. The **Deputy Team Leader** answers instead only when the
   Team Leader is on leave that day. A person with no team, or a team with no leader, goes to the **department lead**.
4. **The answers** (SC-29, SC-30): **book** — the lead keeps or changes the person and the days, and the booking becomes
   the task's assignment, the assignee told as for any assignment; **offer another day** — the asker takes it or asks
   again; **say no**, with a reason — the asker asks another team or does it in her own. Every answer reaches the asker
   on her Schedule ("Asked of other teams") and in her notifications. The asker may withdraw while it waits.
5. **Unanswered after 4 working hours** — a setting, as the other waits are (ADR-0108) — the request is put before
   **Traffic and the department lead** together; the first to act settles it. The team lead can still answer until one
   of them does.
6. **The Schedule shows the viewer's own reach**: a team lead's grid is her team, a department lead's his department,
   Traffic's and the Power Admin's everyone. A task asked of another team shows on the asker's grid as ⏳ until it is
   answered.
7. **Leave and office closures do not change** (ADR-0098 d.3): booking someone's leave stays their own lead's act.
   *Addendum, 3 Oct (Edward, answering Q13):* "Team leads must be able to block time for their team, including leave.
   However they do this via the modal..and then it is added to the leave page automatically." So a lead who may book
   (`bookings:create`) records leave and internal work for the people in her scheduling reach (d.1: a team lead her team,
   a department lead his department, Traffic and the Power Admin everyone) from the Schedule's Block time, **without**
   `leave:manage`; the leave is the same `resource_unavailability` row the Leave page reads. HR holders of `leave:manage`
   keep their reach; office closures are unchanged (`20261003170000`, pgTAP 223).
8. **Requests already on the record** are untouched; the table gains the team, an optional person, the needed-by date,
   the note and an `offered` answer. The old "every scoped lead is told" approvers function is replaced by d.3's order.

## Consequences

- **Easier:** a lead knows everything that lands on her people's week; a cross-team ask is visible and timed instead of
  silent. The request machinery is reused, not rebuilt.
- **Harder:** a cross-team booking takes an answer, up to 4 working hours. Account managers lose direct booking — every
  booking they make is now an ask. The leave check in d.3 needs the leave table on the answer path.
- **Locked in:** "own team" is the booking line for team leads; reversing it is another ADR. The pgTAP suites 140, 141,
  147 and 098 are rewritten to the narrowed reach; ADR-0098's "the person's lead is not told" no longer holds anywhere.
