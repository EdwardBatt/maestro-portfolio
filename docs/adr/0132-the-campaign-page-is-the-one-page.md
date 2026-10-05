# ADR-0132: The campaign page is the one page for editing a campaign, its deliverables and their tasks

- **Status:** accepted (Edward, 30 Sep) — records Edward's answers of 30 Sep; d.2's read-only assignee superseded by ADR-0140, d.2–d.3's editors amended by ADR-0141 (3 Oct)
- **Date:** 2026-09-30
- **Open Decision:** none
- **Amends:** ADR-0110 (a correction to started work is made directly; the change request stays for the client), ADR-0100 (a task the owner adds counts as approved), ADR-0105 d.3 (a lead's click on a task opens the campaign page; the maker keeps the task page), I57.16 (the piece's side panel becomes editable)
- **Task(s):** I68

## Context

Edward, 30 Sep, on the Team page: *"clicking on a task opens only the task, whether someone needs to edit the task, the deliverable or the
campaign, there should be one page… when actions are completed they return the user to the teams page, the my-work page or whichever page
they were originally on."* He added: *"the solution needs to allow everything to be editable and updated… we have had incidents where the
deliverable is incorrect and needs to be changed… When the deliverable is changed existing tasks should be cancelled and the new task list
generated."*

Today the editing is spread over three places:

| What | Where | Reached from the Team page by |
|---|---|---|
| The task | the task page `/my-work/task/…` | clicking a bar |
| The deliverable and its task list | the Deliverables page's window | the task page's "In deliverables" link |
| The campaign | the campaign page | nothing on the task page |

That spread causes three problems:

- **Back lands in the wrong place.** The task page's Back always goes to My Work, and the Deliverables window has no way back to where
  you started.
- **The side panel is read-only.** The piece's panel on the campaign page opens from every view (Grid, Board, Timeline, Season map, Where
  is everything), but the task list, its approval and closing are only in the Deliverables window.
- **A single job opens the campaign layout** and sends you to the Deliverables page to do the work. "Promote to a campaign" is only on
  the Campaigns list's ⋯ menu.

Mockups compared (`Claude outputs/mocks/`):

- `one-page-a-v2.html`: A, the task page grows.
- `one-page-b-v2.html`: B, the campaign page.
- `campaign-page-as-built.html`: the page as built today.

A was cleaner, but it is reached only through a task, so an account manager editing a brief, or a campaign with no tasks yet, would still
need the campaign page. That is two editing pages again. **B chosen.**

Load, measured on the local stack:

| Page | Usable | Loaded |
|---|---|---|
| Campaign page, 27 pieces | 0.5 s | 1.0 s |
| Task page | 0.3 s | 0.85 s |

The campaign page reads its pieces in a few requests, not one per piece.

Edward's answers, one at a time, 30 Sep:

| Question | Chosen | Rejected |
|---|---|---|
| Which page is the one page | B, the campaign page | A, the task page grows |
| How a single job is laid out | the same layout as a campaign, because a job can gain deliverables | the piece laid out on the page |
| Which tabs a single job shows | A, the same six, greyed where they do not apply | only Brief and Grid |
| When a tab greys out | A, when it would be empty | every one-piece job |
| Changing a started deliverable's type | A, directly, asked first, by anyone who may edit it | B, owner direct and the account manager requests; C, keep the change request |
| A task added to an approved list | A, the owner's counts as approved, anyone else's waits | B, all wait; C, none wait |
| The Deliverables page | A, kept as a list, its Open goes to the campaign page | B, removed; C, both kept |

## Decision

1. **The campaign page is where a campaign, its deliverables and their tasks are edited**, for a campaign and a single job alike:
   - "Edit the brief" and "+ Add a deliverable" are on its header;
   - "Promote to a campaign" is on a single job's header.
2. **The piece's side panel becomes the editor.** It opens from every tab, and stays open on the same piece when the tab changes.
   - **Every deliverable field is editable:** name, type, quantity, owner (the department's leads, ADR-0128), due date, channel and
     languages, workstream and phase (campaign only), and the brief lines.
   - **The task list** has four columns: Task, Assignee (read only), Due, Status. Each row has edit and cancel/delete.
   - **Adding a task** is a row at the foot of the list, asking for its name and due date only. The task is created **unassigned**.
     Assigning stays on the Schedule and the Team page.
   - **The panel also carries** the task list's approval and "Close the piece". The task the person came from is marked.
3. **Changing a deliverable's type is direct, asked first**, for anyone who may edit the piece: the owner, the department's leads, the
   account manager, the account director and Traffic. Once confirmed:
   - the old type's open tasks are cancelled and their bookings freed;
   - the assignees are told;
   - finished work is kept;
   - the new type's list is generated.

   The confirmation names what will happen, and the owner is told who changed it. **This amends ADR-0110** for corrections. The change
   request stays for the **client** asking for something different, where a round is spent.
4. **A task added by the deliverable's owner counts as approved; anyone else's waits for the owner.** A type change follows the same rule:
   made by the owner, the new list is approved; made by anyone else, it waits for the owner. **This amends ADR-0100.**
5. **A single job uses the campaign's layout**: the six tabs, its deliverables listed, and the chosen one in the panel. A tab **greys out
   when it would be empty**, with a tip saying why:
   - Season map and Timeline, when nothing is dated;
   - Board and Where is everything, when there is one deliverable.

   Brief and Grid are always on.
6. **Who lands where from a task.**
   - **People who may edit the piece** (leads, account managers, Traffic): clicking a task on the Team page, the Schedule or a dashboard
     opens the campaign page with that piece's panel open and the task marked.
   - **The maker**: their own task opens the task page, as today (upload, send for review, ask for more time).
   - **Notifications about a piece or its task list** open the campaign page with the piece open.
7. **Back names and returns to where you came from**: Team (same week and tab), My Work, the Schedule (same days and view), a dashboard,
   or the Campaigns list (filters kept). It sits at the top and the foot. With no page before it (an email link, a new tab), it reads
   "← Campaigns".
8. **The Deliverables page stays as a list across campaigns**, including its Ad-hoc tab. Its window is retired: "Open", every "Open in
   Deliverables" link and every Needs-you card that pointed there open the campaign page with the piece's panel open.

## Consequences

*Easier:* one place to put a wrong deliverable right, with the task list regenerated in the same step. A lead returns to where they
were. A single job grows into several deliverables, or into a campaign, without changing page.

*Harder:* the side panel becomes a large editor, and every existing link into the Deliverables window has to be moved, including the
Needs-you cards, emails and the task page. The owner no longer gets a say before a correction to started work, only a notice.

*Locked in:* assigning is not done in the panel. It stays on the Schedule and the Team page.

*Cost:* front-end mostly. Two database changes:

- the edit guard admits a direct type change over live tasks, reusing E7's regeneration (`20260926132000`);
- the approval stamp is set when the owner adds a task.

Plus the pgTAP for both and the browser tests the moved controls need.

## Addendum — 30 Sep, found building it

- **A direct due-date change sets aside ADR-0088 d.7a** (a live due date needed the client's agreement on record) for the people in d.3,
  as d.2 makes every field editable. The client's own request still goes as a change request with its evidence.
- **Quantity down cancels the open units above the new count; quantity up brings back a unit cancelled earlier, or adds new ones**,
  unassigned. There was no E7 path for quantity to reuse (an accepted change request wrote the number alone).
- **A deliverable with no owner keeps its approval when a task is added**, because nobody could approve it again.
- **A re-opened list's escalation clock runs from the re-opening** (`deliverables.task_list_reopened_at`), not from the campaign's
  approval. It was escalating at once, and never escalated a second time.
