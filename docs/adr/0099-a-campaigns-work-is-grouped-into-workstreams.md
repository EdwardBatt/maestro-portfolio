# ADR-0099: A campaign's work may be grouped into workstreams

- **Status:** accepted
- **Date:** 2026-09-23
- **Open Decision:** none — this arises from the v3 Figma (section C) and supersedes ADR-0050 d.2
- **Task(s):** `I56.1` (this ADR), gating `I56.3`–`I56.13`

## Context

The v3 Figma draws a campaign's work in **named groups** — *Design & Animation*, *Content*,
*Always-on* — with the deliverables listed under each. Today there is no such thing. A campaign has a flat
list of deliverables, and the only grouping is the department, which is not chosen but **derived**:

> **ADR-0050 d.2** — *"A deliverable's department is derived from its owner, not asked for.
> `deliverables` gains `department_id`, stamped from the owner's own department the way `sub_tasks`
> already stamps its own (derive-don't-ask). Nobody is asked which department a deliverable belongs
> to; naming its owner answers that."*

That rule was right for what it solved — it stopped anyone being asked a question the data already
answered. But it has been the cause of real trouble:

**22 September, on production.** A Creative team leader was refused the assignment of her own team
member on an approved campaign. The deliverable's owner sat in another department, so the deliverable
*was* that department's, and its tasks were outside her reach (ADR-0060 d.9). Changing the owner
moved the deliverable but not its nineteen unassigned tasks (`I53.29`), and Edward then changed the
design so a lead assigns any task within her reach (`I53.30`, ADR-0060 addendum). **The department
had moved because one person's name changed.**

A named group cannot be produced from a department in any case — *Always-on* and *Design & Animation*
may both be Creative.

### Grouping is OPTIONAL

Edward, 23 September: *"the Workstream is meant to be an optional grouping… some campaigns and single
jobs may not require it."*

This is the constraint that shapes the whole ADR, and it rules out the obvious design. If a deliverable's
department came **from** its group, then a deliverable in no group would have no department — and a deliverable
with no department cannot be reached, assigned or found. Optional grouping therefore forces the
department to live on the **deliverable**, with the group as a convenience that fills it in.

That is a better answer anyway. It keeps `deliverables.department_id` authoritative, so everything
that reads it today keeps working, and it removes the owner-derivation — which is the part that
actually caused the incident — without making a second thing load-bearing.

### Options weighed

**A. Keep deriving the department from the owner; draw groups from the department.** No schema
change. Rejected: cannot draw named groups, and leaves the 22 September fault untouched.

**B. A free-text label on each deliverable.** Cheapest grouping. Rejected: nothing owns a label, so
it cannot carry an owner, nothing stops two spellings of one group, and `I56.9`'s deliverable codes need a
stable parent to take their letters from.

**C. A required workstream that owns the department.** What this ADR said in its first draft.
Rejected by Edward's constraint above: it makes grouping compulsory in all but name, because
ungrouped work would have nowhere to get a department from.

**D. An optional workstream; the department lives on the deliverable and the group fills it in.** Chosen.
Grouping is genuinely optional — a small campaign and a single job simply have none — while the
department stops being a side effect of one person's name.

### What this costs

`streams` already exists as the campaign → deliverable join, and is currently invisible plumbing.
The department stamp moves off the owner, so `app.tg_deliverable_stamp_department` and every pgTAP
suite around it change. That is the bulk of the work and it is not small.

## Decision

**d.1 — A campaign's work MAY be grouped into workstreams.** A workstream is a named group belonging
to one campaign, holding any number of deliverables. **A deliverable may belong to no workstream**, and a
campaign may have none at all. Ungrouped work is a normal, permanent state — not a step on the way
to being grouped.

**d.2 — A deliverable's department is its own, and it is chosen.** `deliverables.department_id` stays
where it is and stays authoritative. It is no longer stamped from the owner: this **supersedes
ADR-0050 d.2** for deliverables. (`sub_tasks` keep their own rule — ADR-0060 — untouched.) A deliverable
must have a department, grouped or not; it is what reach and assignment are decided on.

**d.3 — A workstream carries a department, and filling it in is what the group does.** A workstream's
department is required. Adding a deliverable to a workstream, or moving it between workstreams, **sets the
deliverable's department to the group's**. This is the convenience the group exists to provide, and it is
an explicit act by a person, not a trigger firing behind them.

**d.4 — Taking a deliverable OUT of a workstream changes nothing but the grouping.** The deliverable keeps the
department it had. Removing a grouping must never silently move work between departments.

**d.5 — A workstream carries an owner; the picker starts on the department's lead.** Chosen, not
inferred. A workstream may be saved with no owner.

**d.6 — A deliverable's owner is its own.** The workstream's owner answers for the group; a deliverable may name
a different person, and where it names nobody the group's owner answers for it. The *department* is
what the group fills in; the *maker* is always the deliverable's.

**d.7 — Names are free and unique within a campaign.** Short, from the brief's own words, no
department word in them, always editable. Two campaigns may both have an *Always-on*.

**d.8 — Deleting a workstream that still holds deliverables is refused, with the count.** *"This workstream
still holds 6 deliverables. Move them out or remove them first."* Deleting a group is not a way to
delete work. Emptying a group leaves its deliverables ungrouped (d.1) with their departments intact (d.4).

**d.9 — Moving a deliverable between workstreams takes its unassigned tasks with it.** The 22 September
fault (`I53.29`) was that changing a deliverable's department left nineteen tasks behind. That
correction applies here. Tasks already assigned to a named person **stay where they are** — someone
has committed to them — and the surface says how many stayed.

**d.10 — Existing campaigns are NOT grouped.** Their work becomes ungrouped work, which d.1 makes a
legal state. Every deliverable keeps the `department_id` it already has, so nothing moves and no
group is invented with a name nobody chose. A campaign gets workstreams when somebody makes them.

**d.11 — A single job has no workstream.** One deliverable, nothing to group. The work screen does not
offer grouping on a single job.

## Consequences

**Easier.** The department becomes a deliberate statement rather than a side effect of naming one
person — the cause of the 22 September incident. The Figma's work screen becomes drawable. `I56.9`'s
deliverable codes get a stable parent, and because d.7 allows renaming while the code never changes, a
rename cannot renumber a campaign. Nothing has to be migrated: d.10 means the change is additive.

**Harder.** The department must now be **asked for** when a deliverable is created outside a group, where
before it was inferred. That is one more field on the deliverable panel, and every path that creates a
deliverable — the wizard, the proposal, Add deliverable, promotion from a single job — has to supply
it or the deliverable is unreachable. This is the sharp edge of this ADR: a deliverable created with no
department is invisible to the people who should act on it, and the old rule at least guaranteed one.
**The create paths must refuse to save without it**, and that refusal is part of the work, not a
follow-up.

**Locked in.** One workstream per deliverable; no deliverable in two groups. A campaign's grouping is a
partition, not a tagging system. Cross-cutting labels — "everything for the launch event", across
departments — would be a different idea needing its own ADR, and must not be bolted onto this one.

**Reversible.** Because grouping is optional and nothing is migrated (d.10), abandoning workstreams
later means deleting empty groups. That is a deliberate property of choosing D over C.
