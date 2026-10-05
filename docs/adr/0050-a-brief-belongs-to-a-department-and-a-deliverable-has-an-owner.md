# ADR-0050: A brief belongs to a department, and a deliverable has an owner

- **Status:** accepted
- **Date:** 2026-08-27
- **Open Decision:** — (specified by Edward, 27 Aug)
- **Supersedes:** **ADR-0048 d.1** (a campaign-level brief type), **d.4** (the model proposing a
  discipline per deliverable) and **d.5** (one brief per discipline). The rest of ADR-0048 —
  the templates table, the `N/A` rule, the approval gate, the chasing — stands unchanged.
- **Task(s):** I16 (revised); relates to ADR-0020 (Brief Wizard), ADR-0040 (assignment authority),
  ADR-0036 (per-user scope grants), ADR-0029 (internal clients)

## Context

ADR-0048 organised brief generation around **disciplines** (`work_types`): the model picked a
discipline per deliverable, the deliverables made streams, and each stream got a brief.

That was wrong, and Edward said so four times before it landed. In his words, 27 Aug:

> *"I do not need AI to assign a discipline to a deliverable. I want the Account Manager creating
> the brief to assign the deliverables to the deliverable… then the owner of the deliverable can
> generate sub-tasks and assign the sub-tasks based on the correct person. I keep telling you this
> and you are fixated on disciplines and streams… every org is different, it is meant to be a
> multi-tenant system, we need to be flexible."*

And on the shape of his own organisation:

> *"the Creative Department has two teams: the Copy, Social and Content Team and the Art & Video
> Team… all product in those categories is produced by those teams under the department Creative."*

### Why the discipline model failed

**The seeded disciplines are not anybody's organisation.** ADR-0020 seeded six starter
`work_types` — Creative, Social & Content, Production, Influencer, Activation, Paid Media — and
ADR-0048 made them structural. In Edward's agency **Social & Content is a team inside Creative**,
not a sibling of it. The seeded list is not merely differently-named; it is the wrong *shape*, and
no amount of renaming fixes a hierarchy expressed as a flat list.

**There were already two lists for one thing.** `departments` (with `teams`) drives permissions and
scope. `work_types` drove streams, SLA and — after ADR-0048 — briefs. Edward's own phrase was
*"department/discipline/stream Creative"*: one thing, three names, free to disagree. Making briefs
depend on the third list guaranteed they would disagree with the one the permissions use.

**And it asked the model to decide organisational structure.** ADR-0048 d.4 had the model pick a
discipline per deliverable. Which department owns a piece of work is a management decision with
capacity and accountability behind it. It is not an inference from prose, and it is not the
model's to make.

### What was also wrong in the other direction

Corrected mid-discussion, and recorded so the reasoning is not repeated: a brief **per deliverable**
is worse than a brief per discipline, not better. Edward: *"one brief per deliverable is
excessive… what happens when 6 deliverables are assigned to 1 department, you plan to create 6
briefs or 1?"* One. Six documents for one person is worse than one imperfect document, because now
they read six to find out what they are doing.

### The forces

**Ownership is the unit that survives reorganisation.** Departments change names, split and merge;
somebody being accountable for a deliverable does not. Keying the work to a person, and the brief
to that person's department, is the arrangement that keeps working when the org chart changes.

**A brief is read by a group, not an individual.** A department's brief describes what that
department is making. Two people in Art & Video read the same one.

**Sub-tasks routinely cross teams** — Edward's example: a Production deliverable needing streaming
overlays from Art & Video. **This already works**: a sub-task carries its own `department_id` and
`team_id`, derived from the assignee, and does not inherit them from its deliverable. Nothing in
this ADR changes it. What governs it is the *assigner's* write scope (ADR-0040), widened per person
by scope grants (ADR-0036) where a lead needs reach into another department.

## Decision

1. **A deliverable has an owner.** `deliverables` gains `owner_user_id` — the person accountable
   for it. The **Account Manager sets it** when writing the brief. The model never proposes it:
   accountability is a management decision, not an inference from prose.

2. **A deliverable's department is derived from its owner, not asked for.** `deliverables` gains
   `department_id`, stamped from the owner's own department the way `sub_tasks` already stamps
   its own (derive-don't-ask). Nobody is asked which department a deliverable belongs to; naming
   its owner answers that.

3. **One brief per department, per campaign.** New `campaign_briefs`, keyed
   `(campaign_id, department_id)`. Six deliverables owned by three people in one department is
   **one** brief listing all six — not six briefs, and not one per person.

4. **The Account Manager picks each department's brief type.** From `brief_templates` (ADR-0048 d.2,
   unchanged), once per department, at the point of assigning. It is a judgement about the work —
   a shoot needs the Production brief, a month of posts needs the Social brief — and the AM has
   just written the brief the judgement follows from.

5. **There is no campaign-level brief type.** ADR-0048 d.1's radio group leaves step 1 of the
   wizard. It could not be right: a campaign whose departments need a Production brief and a
   Social brief has no single type. `campaigns.brief` keeps the master brief; the *type* moves to
   `campaign_briefs.brief_type`, where the choice actually applies. **`360` is not a brief type at
   all** — it means the campaign spans several departments, which is already visible from having
   more than one.

6. **The model proposes what to make, never who makes it.** `generate-deliverables` returns
   **name and quantity only**. No discipline (ADR-0048 d.4, superseded), no owner, no department.
   A proposed row arrives with an empty owner, and the AM fills it in.

7. **`work_types.brief_type` is removed**, along with the discipline→template mapping and its Admin
   section. They were built on the superseded model. Editing what a brief *contains* stays —
   that is ADR-0048 d.2 and it is unaffected.

8. **Disciplines stay where they were before ADR-0048 touched them.** `work_types` continues to
   carry streams, SLA profiles and lead times. It is simply no longer the spine of the brief
   system. This ADR does **not** merge `work_types` into `departments`, tempting as that is:
   collapsing two live lists touches streams, SLA and bookings, and deserves its own decision
   rather than being smuggled in here.

9. **Cross-department sub-task assignment is unchanged and stays unchanged.** A sub-task's
   department and team come from its assignee, never from its deliverable. An owner in Production
   may assign an overlay to Art & Video **when their own write scope reaches that department**
   (ADR-0040), which for a named lead is what ADR-0036's per-user scope grants exist to give.
   Nothing in this ADR narrows any existing permission.

## Consequences

**Easier.** The wizard stops asking a question with no right answer (a campaign's brief type) and
starts asking one with an obvious answer (who owns this). Briefs land with the department that
does the work, in the numbers a person can actually read. A tenant whose org looks nothing like
the seeded disciplines is no longer fighting the product — nothing structural depends on that list
any more.

**Harder.** `deliverables` grows two columns and there is one more table. The AM does more work at
brief time: naming an owner per deliverable and a brief type per department, where before they
picked one radio button. That is the honest trade — the radio button was quick because it was
answering the wrong question.

**Thrown away.** The discipline→template mapping, its Admin section, and the discipline field in
the deliverable proposal. Built today, on a model Edward had already rejected three times. Recorded
here rather than quietly deleted, because the cost of building on an unchecked assumption is the
point.

**Locked in.** Accountability is a person, set by a human. Department is derived from that person,
never asked. One brief per department per campaign. Brief type is chosen per department by the AM.
The model proposes *what*, never *who*. Sub-tasks keep their own department and team.

**Still open, deliberately.** Whether `work_types` and `departments` should be one list (d.8), and
whether ad-hoc work becomes internal-client campaigns and retires that surface — Edward's own
direction, and each its own decision.

**Cost.** No dependency, no service. One migration (two columns, one table, one dropped column),
one wizard step reshaped, one Admin section removed, one Edge Function schema narrowed.

**Testing.** pgTAP: a deliverable's department is stamped from its owner and cannot be set to
disagree with it; `campaign_briefs` is unique per (campaign, department); RLS allow + deny including
cross-tenant. Unit: the proposal schema has no discipline field and a row arrives with no owner;
the wizard refuses to submit a deliverable with no owner; a department with several deliverables
produces exactly one brief. And explicitly, as a regression guard on d.9: **a sub-task assigned
across departments still works exactly as it does today.**
