# ADR-0057: documents are reviewed offline until Collabora

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** relates to OD 26/29 (Collabora deployment route, `V1.9.1`) — does not resolve them
- **Depends on:** nothing
- **Task(s):** I23

## Context

Internal review (ADR-0025, `I3`) is one of the few surfaces real users exercise daily. What it can
actually do, verified 2026-08-28 in `src/features/deliverables/ReviewPanel.tsx`:

| Uploaded file                                                  | Renders            | Anchored comments                                                                                                                             |
| -------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Image**                                                      | `<img>`            | **Yes** — click to drop a numbered pin; `review_feedback.pos_x` / `pos_y`, held as image-space physical fractions so RTL does not mirror them |
| **Video**                                                      | `<video controls>` | **Yes** — `review_feedback.timecode_ms`; clicking a comment seeks the player to it                                                            |
| **PDF**                                                        | `<iframe>`         | **No.** It displays and nothing can be attached to a point on it                                                                              |
| **Everything else** — `.docx`, `.pptx`, `.ai`, `.psd`, `.indd` | No                 | No. Falls through to a download link and an optional `external_review_url`                                                                    |

So a brochure, an annual report or a pitch deck is reviewed by someone typing _"page 4, second
paragraph"_ into a comment box, and a `.pptx` cannot be seen in the app at all.

Two further constraints shape what is worth doing now:

- **Upload is single-file.** `ReviewPanel.tsx:86` is a bare `<input type="file">` — no `multiple`,
  no `accept`. `media_records` is `unique (deliverable_id, version)` (`20260728110800:24`), so one
  file per deliverable per version is the schema, not the UI.
- **`review_feedback` has no page column.** It carries `pos_x`, `pos_y`, `timecode_ms` and nothing
  else positional. Page-anchored feedback is the "schema extension" already parked under `L1.5`,
  and ADR-0023 describes `review_feedback` as _"page-anchored / positioned feedback"_ — the design
  anticipated it; the column was never added.

The eventual answer already exists in the plan: **`V1.9` — Collabora Online**, WOPI-hosted, with
per-user rights, version-on-save and brand fonts in the container. It is ⚠️-gated on OD 26/29
(source build versus CODE image) and is a substantial piece of infrastructure, not a screen.

The taxonomy work (ADR-0051) makes this more visible rather than more urgent: `PRE-001` Pitch Deck,
`PRT-010` Annual Report, `GUI-001` Brand Guidelines and `CNT-013` Whitepaper all become first-class
deliverable types with workflow templates containing an Internal Review step — a step that, for
those types, currently means "download it".

## Options weighed

**Build PDF page-anchored annotation now.** Add a `page` column, render the PDF with a JavaScript
viewer, pin comments to page plus x/y. Genuinely useful and it covers brochures and reports. Rejected
for now on cost and sequencing: it needs a PDF renderer dependency (licence review under ADR-0002),
a schema change, viewer work, and it still leaves `.pptx` and `.docx` unhandled — which is where
most of the pain actually is, because decks are what clients argue about.

**Convert documents to PDF server-side for review.** One pipeline, everything becomes annotatable.
Rejected: it is a fidelity trap. A deck converted to PDF loses fonts, animation and layout, and a
reviewer marking up a lossy rendering of the artefact is reviewing the wrong thing. It also needs
the same converter Collabora would bring, without any of Collabora's benefits.

**Route documents to an external review service.** `media_records.external_review_url` already
exists for exactly this (OD 18's "loose coupling default"). Rejected as a _default_ — it puts
client-visible work in a third-party tool outside the tenant fence and the residency rules — but it
stays available per-version for a team that wants it.

**Wait for Collabora and change nothing.** What is effectively happening today. Rejected because it
is undocumented: `V1.9` sits in Phase 2 behind two open decisions, and in the meantime nobody has
written down that document review is expected to happen outside the system. A known gap and an
unrecorded one behave the same way until somebody is surprised by it.

## Decision

1. **Until Collabora, documents are reviewed offline.** The reviewer downloads the file, reads it in
   whatever application owns that format, and submits comments as ordinary `review_feedback` rows
   with no positional anchor. This is what happens today; this ADR makes it a stated interim
   position rather than an accident.

2. **The surface says so.** Where a file type cannot be annotated, the review panel states plainly
   that it is download-and-comment and why — not a bare "unsupported" with a download button. A
   reviewer should never be left wondering whether the pin tool is missing or broken. This is the
   `AGENTS.md` §5 warn-and-explain bar applied to a capability gap rather than an error.

3. **Comments on a document are still first-class.** Same rounds, same `resolved` state, same
   request-changes round-trip, same notifications. Nothing about the review _loop_ is degraded — only
   the anchoring. The convention for locating a comment is prose in the comment body, and the
   surface should say that too.

4. **`external_review_url` remains available per version** as a deliberate escape hatch for teams
   that already run document review elsewhere. It is not the default and it is not proposed to
   clients; it is a link a person chooses to add.

5. **Collabora (`V1.9`) is the answer for Office documents**, and this ADR does not pre-empt its open
   decisions. When it lands, `.pptx` and `.docx` review moves into the app and d.1 narrows to
   whatever Collabora does not cover.

6. **PDF page-anchored annotation is a separate, smaller piece of work that does not wait for
   Collabora**, because a PDF needs no editing server — only a viewer and a `review_feedback.page`
   column. It is sequenced after the taxonomy work rather than before it, and it is the first thing
   to do in this area once that lands.

7. **Nothing here changes how many artefacts a unit of work holds.** ADR-0058 moves the artefact from
   the deliverable onto the **sub-task**, so six reels are six sub-tasks each holding their own file
   — which is what makes each individually reviewable. Whether a single sub-task may hold several
   files at once is a different question again, and it is not decided here.

## Consequences

**Easier.** Nothing technically — this is the status quo. What becomes easier is planning: the gap
is written down, sized and sequenced, so `PRE-001` Pitch Deck arriving as a first-class deliverable
type is not a surprise when someone opens it for review.

**Harder.** Document-heavy work stays awkward for as long as this stands, and the taxonomy will make
that more visible by naming the affected deliverable types explicitly. If document review turns out
to be a larger share of the agency's work than the pilot suggests, d.6 should be pulled forward
ahead of other `I18`–`I22` work — that is a scheduling decision on evidence, not a reopening of this
one.

**Locked in.** Nothing structural. This ADR deliberately adds no schema and no dependency; its whole
value is that it records a known limitation and names the two routes out of it.

## Cost

Effectively none for d.1 and d.4 — they describe existing behaviour. d.2 and d.3 are copy and one
conditional branch in `ReviewPanel.tsx`, plus EN and AR keys. d.6 is scoped but not scheduled here.

## Testing

- Unit: a `.docx` version renders the download-and-comment explanation, the download control, and no
  annotation affordance; an image renders the pin tool; a video renders the timecode control.
- Unit: a comment submitted against a non-annotatable version is stored and displayed with no
  anchor, and takes part in rounds and resolution exactly as an anchored one does.
- i18n: both new strings exist in `en` and `ar` — the existing parity test covers it.
