# Reference documents — current source of truth

Authoritative planning documents and diagrams for Maestro, version-controlled with the
code. For any question about roles, workflows, org structure, or scope, **these documents
plus the ADR log (`docs/adr/`) are the source of truth.** A decision that contradicts them
without a superseding ADR is a defect, not a choice.

## Current documents

| Document | File | Governs |
|---|---|---|
| Design draft v15 | `design-draft-v15.docx` (rendered: `../design/design-draft-v15.md`) | Architecture, data-model direction, role surfaces |
| Traffic flow v2 | `diagrams/TrafficFlowV2.drawio` | End-to-end traffic / workflow across roles |
| End-to-end flow | `diagrams/E2Eflow.svg` | Compact end-to-end overview |
| Brief lifecycle | `diagrams/brief_lifecycle_swimlane.svg`, `brief_lifecycle_flow.svg` | Intake → concept → production → review → approval |
| Workflow swimlanes 1–7 | `diagrams/workflow_1..7_*.svg` | Per-role lanes: campaign 360, discipline stream, execution, feedback/revision, booking allocation, approval, joint project |
| Notification email copy | `notification-email-copy.md` | The wording of every notification email — **draft, awaiting Edward** (6 Sep) |

Roles referenced across these documents: **Account Manager, Strategy/Creative Lead,
Discipline Lead, Team Lead, Makers/Producers, Resourcing/Scheduling, Client, Approver,
System.** Departments are the disciplines (Client Services, Creative, Performance,
Production, Influencers, Support).

## Supersession process

When a document here is replaced:

1. Move the **old** file into `_superseded/`, keeping its version tag in the name
   (e.g. `design-draft-v14.docx`, `TrafficFlowV1.drawio`). Never overwrite in place.
2. Add the **new** version here and update the table above (file name + date).
3. If the change alters an architectural decision, record an **ADR** in `docs/adr/`
   (per ADR-0001): the document captures *what*; the ADR captures *why it changed*.

This folder is the canonical, committed copy the codebase is built against.

> **Public portfolio copy.** Client-supplied source material (the agency org chart, its brief-template
> decks and its content master sheet) is not included. Where an ADR or migration cites one of them,
> the citation describes it instead of linking it.
