---
type: capsule
abstract: Who may do what, and to which rows — the most expensive thing on this project to re-derive, and the easiest to get subtly wrong.
status: current
origin: ai-derived
verified: 2026-09-08
sources: [src/auth/, src/policies/]
---

# Capsule — <domain>

<!--
  A capsule is UNDER 60 lines of content and POINTS AT SOURCE. It never pastes code. The lint fails
  it on both counts.

  The `abstract:` above is copied verbatim into MAP.md's row for this file, and the lint compares
  them character for character. Lead with scope; put judgement second.

  Write the thing that is expensive to re-derive by reading the code — the model, the asymmetries,
  the one function everything routes through. Not what a grep would answer.
-->

## The model

<The two or three sentences somebody has to hold in their head. The nouns, and how they relate.>

| Concept | What it is | Enforced by |
|---|---|---|
| | | |

## Where to look

- `path/to/thing.ts` — <what it is, and the one thing to know about it>
- `path/to/other.ts` — <…>

## Constraints

- <A rule that is not obvious from the code and is easy to break.>

## Known problems

<What is not built, or is built and wrong. Say which.>

## Related

<!-- Link the capsules that share a boundary with this one, so a reader who landed in the
     wrong one is one hop from the right one. -->
