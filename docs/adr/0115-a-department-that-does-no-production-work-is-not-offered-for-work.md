# ADR-0115: A department that does no production work is not offered for work

- **Status:** accepted (Edward, 26 Sep: *"accept with 5"* — d.6, the database refusal, included)
- **Date:** 2026-09-26
- **Open Decision:** —
- **Task(s):** `I59.46`

## Context

Edward, 26 Sep: *"Finance, Support, and some others never get assigned deliverables, and neither the dept
or user should be displayed as a choice on /schedule or where a dept needs to be picked … in the case of
CS they are assigned as reviewers and approvers, so they do get assigned, but should not display on
/schedule or as a deliverables dept."*

**What the system has today (checked 26 Sep):**
- `departments` carries a name and nothing else. Every department appears in every department picker:
  a campaign's or single job's department, a deliverable's owner (whose department the deliverable follows,
  ADR-0102), the Schedule's Department and Team filters, and the Team page.
- The Schedule lists bookable **resources**. A person becomes one through the "Also a bookable resource"
  tick at invitation. Nothing ties that tick to the kind of department, so a Finance person with the tick
  is offered for work, and nothing keeps Finance out of the department pickers.
- Reviewer and approver pickers list **people**, not resources. That is why CS can stay in them whatever
  this ADR decides for the Schedule.

In production, only Creative has been given work so far (Edward, 26 Sep). Switching the others off
therefore changes no live work.

**Options put to Edward, one at a time (26 Sep):**
1. *Where the switch lives.*
   - **A. Per department** (chosen). Set once, and a new hire follows their department.
   - B. Per person: finer, but every person has to be marked, and a new hire shows on the Schedule until
     someone remembers.
2. *Work already in a department that is switched off.*
   - **A. Refuse until it has moved, naming it** (chosen).
   - B. Allow it: the work stays, but a booking would sit on a person the Schedule no longer shows,
     where nobody can see or move it.
3. *The Team page.*
   - **A. It follows the switch** (chosen). It is about production work and capacity, and these
     departments would only show empty rows.
   - B. It stays as it is.

## Decision

1. **A department has one setting, "takes production work"** (`departments.is_production boolean not null
   default true`). Every existing department starts **on**, so nothing changes until an admin switches one
   off.
2. **It is set on the Organization page**, with the existing department setup, by whoever may edit
   departments today. No new permission.
3. **Off means not offered for work.** The department and its people drop out of:
   - the Schedule: its rows, and its Department and Team filters;
   - the Team page;
   - every department picker on a campaign or single job;
   - every deliverable-owner picker;
   - every picker that gives a task or a booking to a person (assignee, booking, the lead to give it to).
4. **Off does not mean invisible.** The department's people still appear, unchanged, in:
   - reviewer and approver pickers (CS, 26 Sep);
   - the Directory, Leave, Users and Roles;
   - every record of past work.
5. **Switching off is refused while the department still owns live work.** "Live" means a deliverable
   not finished or archived, a task not done or cancelled, or a booking from today on. The refusal names
   what has to move, and the database enforces it, not only the screen. Switching back on is always
   allowed.
6. **The database refuses new work there too.** A deliverable, a task assignment or a booking that would
   land in a switched-off department is refused with words naming the department. So a stale screen or a
   direct call cannot put work where the pickers would not.

## Consequences

- **Easier:** the Schedule and the pickers show only the people and departments that do the work. A
  Finance or Support hire no longer appears on the Schedule because someone ticked "bookable" out of habit.
- **Harder:** every place that offers a person or a department for work must read the switch. A picker
  missed is one that still offers Finance; the database refusal (d.6) is the backstop, and the browser
  suites cover each picker.
- **Locked in:** "does this department take work" is a department fact, not a person's. A person in a
  switched-off department who must take one piece of work is moved to a department that takes work;
  there is no per-person override. A later ADR adds one if it is ever needed.
- **Not changed:** who reviews and approves (ADR-0038/0043), and where a deliverable's department comes
  from (ADR-0102: it follows its owner).
