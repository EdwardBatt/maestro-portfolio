# ADR-0128: An owner list offers only the leads of the deliverable's own department

- **Status:** accepted (Edward, 30 Sep) — records Edward's answer of 29 Sep, already built and on production
- **Date:** 2026-09-30
- **Open Decision:** none
- **Narrows:** ADR-0101 (owners are department leads, team leads and deputy team leads, "the group's own department first"); relies on ADR-0102 (a deliverable's department follows its owner)
- **Task(s):** I66.9 (extends I54.30 from the Single job to every owner list)

## Context

Edward, 29 Sep: *"even when a deliverable is assigned to creative it lists department and team leads for
non-creative team members… i thought we agreed to filter the options."*

The filter had been agreed and built for the Single job only (I54.30). Everywhere else:

- A department- or team-scoped viewer saw their own department's leads.
- Traffic, account managers and admins saw **every** lead in the company.

Since ADR-0102 moves a piece's department with its owner, that list also moved pieces between departments.
One wrong name from a company-wide list moved a piece.

- **(A) Only the department's own leads.** Edward chose this.
- **(B) Own department first, with a switch to show the others.** Rejected: it keeps the accidental move
  one click away.

## Decision

1. **Every owner list offers only the leads of the deliverable's own department.** On a campaign, that
   is its workstream's department, or the department chosen in the dialog. This covers Edit piece, the
   Deliverables page's owner control, Add a deliverable, Propose more, the wizard's piece dialog and
   workstream owners, and the campaign page's workstream panel.
2. **Where there is no department yet, or the department has no lead, every lead is offered.** The UI
   never blocks. The database still decides (`app.tg_deliverable_owner_is_a_lead`).
3. **Moving a piece to another department is a separate step: its workstream.** It is not a side effect
   of picking an owner.
4. **One rule:** `src/lib/people/leads-of-department.ts`, used by every list above.

## Consequences

*Easier:* the list is short, and a piece no longer changes department by accident.

*Harder:* to hand a piece to another department's lead, you first move it (its workstream), then pick the
owner. That is two steps where there was one.

*Locked in:* the owner list is not a way to move work between departments.

*Cost:* no migration; one shared helper; the EditPieceDialog, DeliverablesPage and BriefWizard tests
brought to the rule.
