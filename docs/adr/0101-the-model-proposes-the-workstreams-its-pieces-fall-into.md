# ADR-0101: The model proposes the workstreams its pieces fall into

- **Status:** accepted (Edward, 24 Sep: *"Correct with one small note reassignment should be allowed"*)
- **Date:** 2026-09-24
- **Task(s):** `I56.4` (Figma `CB-v3-02b` · Proposed from the brief)
- **Amends:** [ADR-0050](0050-a-brief-belongs-to-a-department-and-a-deliverable-has-an-owner.md)
  d.6 (for the department only) · **Extends:** [ADR-0097](0097-the-model-proposes-deliverables-from-the-catalogue-only.md)
  (the shape of the answer grows; the catalogue-only rule does not change)
- **Depends on:** [ADR-0099](0099-a-campaigns-work-is-grouped-into-workstreams.md) (optional
  workstreams; the department lives on the deliverable and the group fills it in),
  [ADR-0048](0048-briefs-are-generated-per-discipline-and-approved-before-work-starts.md) d.4
  (nothing proposed exists until a person keeps it)

## Context

`CB-v3-02b` is a second screen inside step 2 of the campaign wizard, shown after the brief:
*"Here is what the brief suggests we make"*. The proposals arrive already **grouped into named
workstreams, each with a department** — *Design & Creative · CREATIVE*, *Short-form video ·
CONTENT* — each row saying which line of the brief it came from, with Keep all / Drop all and
**+ Add** per group, and **+ New workstream** for what the brief did not suggest.

Edward settled the behaviour when section C was specified (22–23 Sep), recorded as `I56.4`: *the
proposal returns named groups with a department as well as pieces, each piece saying which line of
the brief it came from; Keep all / Drop all per group; nothing exists until kept. Names come from
the brief's own words — short, no department word, unique in the campaign, always editable; no
sensible name falls back to the department's.* The catalogue-only rule stays (ADR-0097).

What stands in the way is **ADR-0050 d.6**: *"`generate-deliverables` returns name and quantity
only. No discipline, no owner, no department."* A group that arrives with a department breaks the
last clause. This ADR records that change and nothing wider.

**The department cannot be derived instead.** Measured 24 Sep on the seeded tenant: of 257 active
deliverable types, **0** reach a department through `brief_deliverable_types` →
`department_brief_templates`, and `deliverable_categories` carries no department. The catalogue says
what a piece *is*, never who makes it.

### Options weighed

**A — Group by catalogue category, department left for the AM.** No model change. But categories
are not workstreams (*Social media* is not *Short-form video*), every group arrives with no
department, and it is not what Edward agreed.

**B — The model proposes the groups and their departments, from the tenant's department names.**
What `I56.4` says. Costs a larger prompt and one relaxed clause of ADR-0050 d.6. **Chosen.**

**C — One ungrouped list; the AM builds workstreams by hand.** Simplest; drops the frame's point.

## Decision

1. **`generate-deliverables` returns groups.** Each group has a `name`, a `department` and its
   `pieces`. A piece is what ADR-0097 already returns — catalogue code, quantity, channel, phase —
   plus **`from`**: the short line of the brief it came from, quoted, never paraphrased (the frame's
   *from "make the mechanic obvious"*).
2. **The model is shown the tenant's department NAMES, and nothing else about the organisation.**
   ADR-0050 d.6 is amended for this one point: a proposed **group** may carry a department. It still
   proposes **what, never who** — no owner, no person, no team. The department is a proposal the AM
   sees and can change before anything exists.
3. **A department the tenant does not have is dropped, not guessed.** The group arrives with no
   department (*"no department yet"*) and the AM sets it — the same rule ADR-0097 d.4 applies to a
   code outside the catalogue.
4. **The catalogue-only rule is unchanged** (ADR-0097). A piece is named by its catalogue entry;
   the brief's own wording is its `from`, never its name.
5. **Group names come from the brief's own words**: short, no department word, unique within the
   campaign, always editable. With no sensible name, the group is named after its department.
6. **Nothing exists until kept** (ADR-0048 d.4). The screen offers Keep / Drop per piece, Keep all /
   Drop all and **+ Add** per group, and **+ New workstream**. *Keep these — go to the work* writes
   the kept groups as the draft's workstreams and the kept pieces into them; dropped ones are
   discarded. Back returns to the brief with the proposal kept for the next visit.
   **Amended 24 Sep (Edward): the proposal lands on step 3, The work — not a second screen inside
   step 2.** *"2b should be step 3 the work and the button should read Keep these - go to timing."*
   The two screens were the same list reviewed twice. Proposed pieces carry the tick, the line they
   came from and PROPOSED; pieces the person adds are plain work with a remove. *Keep these — go to
   timing* discards the unticked pieces and any proposed group left empty, then asks what the work
   step always asked — an owner and a catalogue entry per kept piece, a department per kept group.
7. **An empty or failed proposal says so** (ADR-0097 d.5) and leaves **+ New workstream** usable —
   the person can always carry on by hand.
8. **An owner can be named alongside the department** (Edward, 24 Sep). On each proposed workstream,
   and on **+ New workstream**, the account manager may pick the group's owner. **Eligible owners are
   department leads, team leads and deputy team leads** (Edward, 24 Sep — a deputy stands in with the
   team lead's authority, ADR-0017) — nobody else is offered. The list shows the group's own
   department first — its department lead, then its team leads and deputies — and then the same
   roles in every other department; a group may still be kept
   with no owner (ADR-0099 d.5). The model does **not** propose the owner: that stays ADR-0050 d.6's "never who".
   The rule is enforced where the workstream is written (`create_workstream` / its update refuse an
   owner who is not a department lead, team lead or deputy team lead), not only in the picker.
   **Reassignment is allowed** (Edward, 24 Sep): the owner can be changed to another eligible person,
   or cleared, at any time — on the proposal screen, on the work screen, and after the campaign is
   approved — under the same eligibility rule.

9. **Workstreams are a switch** (Edward, 24 Sep: *"Step 1 adjacent to phases. Default on"*). ADR-0099
   made grouping optional but gave nobody a way to say so, and once the model proposed groups every
   campaign arrived grouped. Step 1 carries a *Workstreams* switch beside *Phases*, **on by
   default**. **Off:** the model is asked for pieces only — no groups, and no department list is
   sent — and The work is one plain list: no group pickers, no + New workstream, no Move, no
   workstream field in the piece dialog; each piece's department comes from its owner (ADR-0099,
   ungrouped work). Switching off while pieces sit in workstreams is refused with the count, as the
   phases switch refuses; off with only empty groups removes them. Saved with the draft; a draft
   saved before the switch resumes on.

## Consequences

- **Easier:** the account manager starts from a grouped plan with departments filled in, rather than
  a flat list to sort. Step 3 receives pieces that already belong somewhere.
- **Harder:** the prompt carries the department list; the structured-output schema and its Zod
  check grow; the model can misjudge a department. The misjudgement is cheap — the group is a
  proposal, shown before anything exists, and editable after.
- **Locked in:** department names leave the tenant for the model provider (ADR-0049) — names only,
  already visible on every campaign. Owners are still never proposed by the model; the AM names the
  group's owner from the department leads, team leads and deputies, and step 3 still requires an owner per piece
  (where it names nobody, ADR-0099 d.6: the group's owner answers for it).
- **Narrower than ADR-0099 d.5:** a workstream's owner was anyone; it is now a department lead, a
  team lead or a deputy team lead. Existing workstreams whose owner is neither keep their owner — the rule applies when an
  owner is set.
- **Not decided here:** per-department load on the proposal screen, and codes per piece (`I56.9`).
