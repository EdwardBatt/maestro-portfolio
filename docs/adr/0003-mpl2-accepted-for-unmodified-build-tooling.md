# ADR-0003: MPL-2.0 accepted for unmodified build-time tooling

- **Status:** accepted
- **Date:** 2026-07-28
- **Open Decision:** — (applies ADR-0002 §1)
- **Task(s):** 0.1.4

## Context

ADR-0002 requires an ADR for any MPL-2.0 dependency. The CI license allowlist surfaced three:
`lightningcss` and its two platform binaries — the CSS transformer used internally by Vite 8
during development and build. MPL-2.0 is file-level copyleft: obligations attach only to
modifications of the MPL-licensed files themselves, not to code that uses the tool or to its
output. lightningcss processes our CSS at build time; no Maestro code links against it and
nothing MPL-licensed ships inside the product bundle.

## Decision

MPL-2.0 dependencies are acceptable **when all of the following hold**: the package is used
as unmodified tooling (build, dev, test); it is not forked or patched; and no MPL-licensed
code is distributed as part of the Maestro product. lightningcss (via Vite) is accepted under
this rule. The CI allowlist therefore includes MPL-2.0, with this ADR as the governing
constraint — reviewers must verify any *new* MPL package is tooling-only.

Anything outside this shape — an MPL library imported into product code, or a *modified* MPL
component (e.g. the contemplated Collabora edit-event patch, §8.4) — still requires its own
case-by-case ADR.

## Consequences

Easier: the standard Vite toolchain works without exception-listing every transitive binary.
Harder: reviewers carry a judgment call on new MPL packages (tooling vs. product code) — the
CI gate alone cannot distinguish them. Locked in: the Collabora patch decision (OD 29)
cannot ride on this ADR; modifying MPL code is explicitly out of this rule's scope.
